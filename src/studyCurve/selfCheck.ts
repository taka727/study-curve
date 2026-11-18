// 既存のノートに「思い出せるか」の空欄と判定表を差し込む（#2）。
// Obsidian に依存しない純粋な関数だけを置き、ユニットテストで固める。
import { CODE_FENCE_CLOSE, CODE_FENCE_OPEN, Line, frontmatterLength, splitLines } from './checkboxes';
import { ANSWER_HEADING, SELF_CHECK_KEYWORD, SELF_CHECK_SECTION } from './noteFile';

const BLANK = /^[ \t]*$/;
// # の後に空白か行末が必要（#タグ は見出しではない）。4文字以上の字下げは見出しではない
const ATX_HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const H1 = /^ {0,3}#(?=[ \t]|$)/;

/**
 * 見出しに keyword を含むものがあるか。frontmatter とコードブロック（``` と ~~~）の中は見ない。
 * 大文字と小文字は区別しない
 */
export function hasHeadingContaining(content: string, keyword: string): boolean {
	const needle = keyword.trim().toLowerCase();
	const lines = splitLines(content);
	let fence: string | null = null;
	for (let i = frontmatterLength(lines); i < lines.length; i++) {
		const text = lines[i]!.text;
		if (fence !== null) {
			// 閉じは、開きと同じ記号で長さが開き以上、その後は空白だけの行（clearChecksInSection と同じ）
			const close = CODE_FENCE_CLOSE.exec(text)?.[1];
			if (close !== undefined && close[0] === fence[0] && close.length >= fence.length) fence = null;
			continue;
		}
		// バッククォートの開きの情報文字列にバッククォートがあれば、開きではない
		const open = CODE_FENCE_OPEN.exec(text);
		if (open !== null && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
			fence = open[1]!;
			continue;
		}
		const heading = ATX_HEADING.exec(text);
		if (heading && heading[2]!.toLowerCase().includes(needle)) return true;
	}
	return false;
}

/**
 * 「思い出せるか」の空欄と判定表を差し込んだ本文を返す。もう欄があれば null（何もしない）。
 *
 * - 差し込む場所：frontmatter の後。本文が `# タイトル` で始まるなら、その行の後
 * - 差し込んだ欄と元の本文のあいだに `---` と答え合わせの見出しを入れる（元の本文が答え合わせになる）。
 *   見出しで欄を閉じるので、採点時にチェックを外すのは欄の中だけで、元の本文のチェックは残る。
 *   元の本文が空なら入れない
 * - 改行コードは、ファイルの最初の改行にそろえる（なければ LF）。元の行の改行コードは変えない
 */
export function insertSelfCheckSection(content: string): string | null {
	if (hasHeadingContaining(content, SELF_CHECK_KEYWORD)) return null;

	const lines = splitLines(content);
	const eol = lines.find((line) => line.eol !== '')?.eol ?? '\n';
	let insertAt = frontmatterLength(lines);
	let first = insertAt;
	while (first < lines.length && BLANK.test(lines[first]!.text)) first++;
	if (first < lines.length && H1.test(lines[first]!.text)) insertAt = first + 1;

	const head = joinLines(lines.slice(0, insertAt), eol);
	// 差し込む場所の後の空行は、差し込む欄の区切りで置き換える
	let restAt = insertAt;
	while (restAt < lines.length && BLANK.test(lines[restAt]!.text)) restAt++;
	const rest = joinLines(lines.slice(restAt), eol, false);

	const section = SELF_CHECK_SECTION.replace(/\n/g, eol);
	const parts = [head];
	// タイトルの後なら、タイトルと欄のあいだに空行を1つ
	if (insertAt > 0 && insertAt === first + 1) parts.push(eol);
	parts.push(section);
	if (rest !== '') parts.push(eol, '---', eol, eol, ANSWER_HEADING, eol, eol, rest);
	return parts.join('');
}

/**
 * 行をつなぎ直す。terminate が true なら、最後の行に改行がなくても eol を足す
 * （差し込む欄が前の行とつながらないように）
 */
function joinLines(lines: Line[], eol: string, terminate = true): string {
	return lines
		.map((line, i) => line.text + (line.eol === '' && terminate && i === lines.length - 1 ? eol : line.eol))
		.join('');
}
