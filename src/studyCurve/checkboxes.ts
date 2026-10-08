// 採点時に「思い出せるか」の自己チェックを外す処理（#20）。
// Obsidian に依存しない純粋な関数だけを置き、ユニットテストで固める。

/** 1行分。text は行の本体、eol はその行の改行コード（最終行で改行がなければ ''） */
export interface Line {
	text: string;
	eol: string;
}

/**
 * 行に分ける。改行コード（CRLF・CR・LF）は行ごとに元のまま持つ。
 * つなぎ直す（text + eol を順に連結する）と、必ず元の文字列に戻る。
 */
export function splitLines(content: string): Line[] {
	// \r\n を1つの改行として扱うため、選択肢では \r\n を先に書く。
	// 最終行に改行がなくても落とさない（[^\r\n]+$）
	const pieces = content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
	return pieces.map((piece) => {
		const eol = /(?:\r\n|\r|\n)$/.exec(piece)?.[0] ?? '';
		return { text: piece.slice(0, piece.length - eol.length), eol };
	});
}

const FRONTMATTER_FENCE = /^---[ \t]*$/;
const BLANK = /^[ \t]*$/;
// 引用・コールアウトの > の1段分（> の後の空白1つまでを含む）
const QUOTE_MARKER = /^[ \t]*>[ \t]?/;
// 行頭の字下げは何文字でも開きとみなす（CommonMark は3文字まで）。
// リストの中に入れた、深く字下げされたコードブロックの中のチェックも外さないため
const CODE_FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const CODE_FENCE_CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
// 箇条書きか番号付きのリストの項目（チェックの有無を問わない）
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
// # の後に空白か行末が必要（#タグ は見出しではない）。4文字以上の字下げは見出しではない
const ATX_HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const ATX_CLOSING = /[ \t]+#+[ \t]*$/;
// 引用・コールアウトの > と字下げの後の、箇条書き（- * +）か番号付き（1. 1)）の完了のチェック。
// ] の後に空白か行末が必要（- [x]foo はタスクではない）。[-] などの独自の状態は対象外
const TASK_DONE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[xX]\](?=[ \t]|$)/;

/** 行頭の字下げの幅。タブは次の4の倍数の位置まで進める（CommonMark と同じ） */
function indentWidth(text: string): number {
	let width = 0;
	for (const char of text) {
		if (char === ' ') width++;
		else if (char === '\t') width += 4 - (width % 4);
		else break;
	}
	return width;
}

/** 引用・コールアウトの > を外側から順に外し、段数と残りを返す */
function unquote(text: string): { depth: number; rest: string } {
	let depth = 0;
	let rest = text;
	for (let m = QUOTE_MARKER.exec(rest); m; m = QUOTE_MARKER.exec(rest)) {
		depth++;
		rest = rest.slice(m[0].length);
	}
	return { depth, rest };
}

/** 引用・コールアウトの > を外側から depth 段だけ外した残り。> が足りなければ null */
function stripQuotes(text: string, depth: number): string | null {
	let rest = text;
	for (let i = 0; i < depth; i++) {
		const m = QUOTE_MARKER.exec(rest);
		if (!m) return null;
		rest = rest.slice(m[0].length);
	}
	return rest;
}

/** 先頭の frontmatter の行数。閉じがなければ frontmatter ではない（Obsidian と同じ）ので 0 */
function frontmatterLength(lines: Line[]): number {
	if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0]!.text)) return 0;
	for (let i = 1; i < lines.length; i++) {
		if (FRONTMATTER_FENCE.test(lines[i]!.text)) return i + 1;
	}
	return 0;
}

/**
 * 見出しに keyword を含むセクションの中にある完了チェック（- [x]）を、未完了（- [ ]）に戻す。
 * 「思い出せるか」の自己チェックを毎回やり直すための処理で、ほかの場所のチェックは触らない。
 *
 * - セクション：keyword を含む ATX 見出しから、同じかそれより上のレベルの次の見出しの手前まで
 * - 対象外：frontmatter、コードブロック（``` と ~~~。引用・コールアウトの中のものも含む）、
 *   字下げ（4文字以上）だけで表したコードブロックの中。setext 見出しは見出しとして扱わない
 * - 改行コードは行ごとに元のまま保つ。変更がなければ content と同じ文字列を返す
 * @param keyword 空（空白のみ）なら何もしない。大文字と小文字は区別しない
 */
export function clearChecksInSection(content: string, keyword: string): string {
	const needle = keyword.trim().toLowerCase();
	if (needle === '') return content;

	const lines = splitLines(content);
	// depth は開きの行の引用の段数。閉じの行も同じ段数の > を外してから判定する
	let fence: { char: string; length: number; depth: number } | null = null;
	let indentedCode = false;
	// リストの中か。リストの中の字下げは入れ子の項目や続きの段落で、コードブロックではない
	let inList = false;
	// 直前の行の種類。字下げのコードブロックは段落の途中からは始まらない（CommonMark と同じ）
	let prev: 'start' | 'blank' | 'block' | 'text' = 'start';
	let sectionLevel: number | null = null;
	let changed = false;

	for (let i = frontmatterLength(lines); i < lines.length; i++) {
		const line = lines[i]!;

		// (a) コードブロックの中。閉じは開きと同じ記号で、長さが開き以上
		if (fence !== null) {
			const rest = stripQuotes(line.text, fence.depth);
			if (rest !== null) {
				const close = CODE_FENCE_CLOSE.exec(rest);
				if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
					fence = null;
					prev = 'block';
				}
				continue;
			}
			// 引用が終わると、その中のコードブロックも終わる。この行は下で普通に判定する
			fence = null;
			prev = 'block';
		}

		// (a2) 字下げのコードブロックの中。空行と4文字以上の字下げの行が続くあいだ
		if (indentedCode) {
			if (BLANK.test(line.text) || indentWidth(line.text) >= 4) continue;
			indentedCode = false;
		}

		if (BLANK.test(line.text)) {
			prev = 'blank';
			continue;
		}

		// (a3) 字下げのコードブロックの開き。リストの中や段落の続きの字下げは除く
		if (!inList && prev !== 'text' && indentWidth(line.text) >= 4) {
			indentedCode = true;
			continue;
		}

		// コードブロックの開きか。バッククォートの情報文字列にバッククォートがあれば開きではない
		const quoted = unquote(line.text);
		const open = CODE_FENCE_OPEN.exec(quoted.rest);
		const fenceMarker = open !== null && !(open[1]![0] === '`' && open[2]!.includes('`')) ? open[1]! : null;

		// リストの出入り。字下げのない行（項目でないもの）のうち、空行の後の行と、
		// コードブロックの開き・引用の行でリストは終わる（この2つは項目の段落の続きにならない）
		if (LIST_ITEM.test(line.text)) inList = true;
		else if (indentWidth(line.text) < 2 && (prev === 'blank' || fenceMarker !== null || quoted.depth > 0)) {
			inList = false;
		}

		// (b) コードブロックの開き
		if (fenceMarker !== null) {
			fence = { char: fenceMarker[0]!, length: fenceMarker.length, depth: quoted.depth };
			continue;
		}

		// (c) ATX 見出し。同じかそれより上のレベルで、対象のセクションを終える
		const heading = ATX_HEADING.exec(line.text);
		if (heading) {
			const level = heading[1]!.length;
			const title = heading[2]!.replace(ATX_CLOSING, '').trim().toLowerCase();
			if (sectionLevel !== null && level <= sectionLevel) sectionLevel = null;
			if (sectionLevel === null && title.includes(needle)) sectionLevel = level;
			inList = false;
			prev = 'block';
			continue;
		}

		prev = 'text';

		// (e) 対象のセクションの中のチェックを外す（1行につき先頭の1か所だけ）
		if (sectionLevel !== null) {
			const replaced = line.text.replace(TASK_DONE, '$1[ ]');
			if (replaced !== line.text) {
				line.text = replaced;
				changed = true;
			}
		}
	}

	if (!changed) return content;
	return lines.map((line) => line.text + line.eol).join('');
}
