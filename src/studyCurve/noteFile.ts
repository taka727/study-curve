// 「復習ノートを作成」（#10）のファイル名とテンプレートを扱う。
// Obsidian に依存しない純粋な関数だけを置き、ユニットテストで固める。

/** タイトルからファイル名に使える文字が残らなかったときのファイル名 */
export const DEFAULT_NOTE_TITLE = '無題の復習ノート';

/**
 * 内蔵の型。{{title}} などは renderTemplate で置き換える。
 * 見出し「思い出せるか」は、採点時にチェックを外す見出しの既定値（#20 の checkSectionHeading）とそろえる
 */
export const DEFAULT_NOTE_TEMPLATE = `# {{title}}

## ✅ 思い出せるか（読む前に）

> 例を見て答えを思い浮かべてから、下の答え合わせを読む。

**例1**

**例2**

**例3**

| 判定 | 基準 | 次回 |
|---|---|---|
| **☆ 初見** | この内容を学ぶのが初めて | 3日後 |
| **◯** | 答え合わせの太字を自分の言葉で言えた | ステージ +1 |
| **△** | 太字は言えたが「なぜ」が出てこない | 据え置き |
| **✗** | 一度学んだはずなのに出てこない | 翌日 |

---

## 🎯 答え合わせ — これを覚えていればOK

- **OK**：
- **なぜ**：
`;

// 多くのファイルシステムの上限 255 バイトから、番号（" 999"）と拡張子（".md"）の分と余裕を引いた値
const DEFAULT_MAX_BYTES = 180;

// OS でファイル名に使えない文字（\ / : * ? " < > |）と、Obsidian のリンクで意味を持つ文字（# ^ [ ]）
const UNSAFE_CHARS = /[\\/:*?"<>|#^[\]]/g;
// ノーブレークスペース。Obsidian の normalizePath が普通の空白に変えるので、先に変えておく
// （変えずに残すと、重複の確認と実際に作るパスが食い違い、同名のファイルを見落とす）
const NON_BREAKING_SPACES = /[\u00A0\u202F]/g;
// Windows の予約名。拡張子が付いても（CON.md）使えないので、最初の . の前で判定する
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;

const encoder = new TextEncoder();

/** 先頭の . と空白（. で始まるファイルは Obsidian に無視される）、末尾の . と空白（Windows で使えない）を取る */
function trimEnds(name: string): string {
	return name.replace(/^[. ]+/, '').replace(/[. ]+$/, '');
}

/** 制御文字（U+0000〜U+001F と U+007F。改行を含む）を空白にする */
function replaceControlChars(text: string): string {
	return Array.from(text, (char) => {
		const code = char.charCodeAt(0);
		return code < 0x20 || code === 0x7f ? ' ' : char;
	}).join('');
}

/** UTF-8 で maxBytes 以下になるよう、文字（コードポイント）の単位で切り詰める */
function truncateBytes(name: string, maxBytes: number): string {
	if (encoder.encode(name).length <= maxBytes) return name;
	let result = '';
	let bytes = 0;
	for (const char of name) {
		bytes += encoder.encode(char).length;
		if (bytes > maxBytes) break;
		result += char;
	}
	return result;
}

/**
 * タイトルをファイル名（拡張子なし）に整える。使えるものが残らなければ ''。
 * @param maxBytes UTF-8 のバイト数の上限（既定 180。日本語なら60文字）
 */
export function sanitizeFileName(title: string, maxBytes = DEFAULT_MAX_BYTES): string {
	// normalize：macOS の入力で濁点が分かれた形になるのを防ぐ
	let name = replaceControlChars(title.normalize('NFC'))
		.replace(UNSAFE_CHARS, ' ')
		.replace(NON_BREAKING_SPACES, ' ')
		.replace(/ {2,}/g, ' ');
	name = trimEnds(name).replace(WINDOWS_RESERVED, '$1_');
	return trimEnds(truncateBytes(name, maxBytes));
}

/** フォルダとファイル名をつなぐ。folder が '' なら name だけ */
export function joinPath(folder: string, name: string): string {
	return folder === '' ? name : `${folder}/${name}`;
}

/**
 * `{folder}/{baseName}.{extension}` が exists で false になるまで
 * `{baseName} 1`、`{baseName} 2`… を試す。番号が maxAttempts を超えたら例外。
 */
export function uniquePath(
	folder: string,
	baseName: string,
	extension: string,
	exists: (path: string) => boolean,
	maxAttempts = 999,
): string {
	const first = joinPath(folder, `${baseName}.${extension}`);
	if (!exists(first)) return first;
	for (let n = 1; n <= maxAttempts; n++) {
		const candidate = joinPath(folder, `${baseName} ${n}.${extension}`);
		if (!exists(candidate)) return candidate;
	}
	throw new Error(`同じ名前のファイルが多すぎるため、作成できません：${baseName}`);
}

export interface TemplateVars {
	title: string;
	deck: string;
	/** YYYY-MM-DD */
	date: string;
}

/**
 * {{title}}・{{deck}}・{{date}}（中括弧の内側の空白は許す）を置き換える。それ以外は触らない。
 * 1回の走査で置き換えるので、置き換えた値の中の {{deck}} などをもう一度展開しない
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
	return template.replace(
		/\{\{\s*(title|deck|date)\s*\}\}/g,
		(_match, key: keyof TemplateVars) => vars[key],
	);
}
