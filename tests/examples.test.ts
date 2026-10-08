import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_TEMPLATE } from '../src/studyCurve/noteFile';

// 書き方ガイドのサンプル（docs/examples/）が、内蔵の型（#10 の DEFAULT_NOTE_TEMPLATE）とずれていないか（#13）。
// 設計書 §6.1 の表。内蔵の型を変えたら、サンプルとガイドの「内蔵の型の全文」も同じ PR で直す

const EXAMPLES = new URL('../docs/examples/', import.meta.url);

function lines(text: string): string[] {
	return text.split(/\r?\n/);
}

function headings(text: string): string[] {
	return lines(text).filter((line) => line.startsWith('## '));
}

function tableRows(text: string): string[] {
	return lines(text).filter((line) => line.startsWith('|'));
}

function examples(lang: 'ja' | 'en'): { name: string; text: string }[] {
	const dir = new URL(`${lang}/`, EXAMPLES);
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));
}

/** 行頭の frontmatter（--- で囲んだ部分）のキー。なければ空。閉じの --- は行の全体（後ろに文字が続かない） */
function frontmatterKeys(text: string): string[] {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) return [];
	return lines(match[1]!)
		.map((line) => /^([^\s:#][^:]*):/.exec(line)?.[1]?.trim())
		.filter((key): key is string => key !== undefined);
}

const GUIDE = new URL('../docs/guide/', import.meta.url);

/**
 * ガイドの中の ```markdown のコードブロック（出てくる順）。改行は LF にそろえてから取り出す
 * （Windows の core.autocrlf で CRLF になっても、LF で書いた DEFAULT_NOTE_TEMPLATE と比べられるように）
 */
function markdownBlocks(path: string): string[] {
	const text = readFileSync(new URL(path, GUIDE), 'utf8').replace(/\r\n/g, '\n');
	return [...text.matchAll(/^```markdown\n([\s\S]*?)^```$/gm)].map((match) => match[1]!);
}

const ja = examples('ja');
const en = examples('en');
const all = [...ja.map((e) => ({ ...e, lang: 'ja' })), ...en.map((e) => ({ ...e, lang: 'en' }))];
// ガイドの英語版の「英語の型の全文」。順番ではなく見出しで探す（前に例のコードブロックが増えても取り違えない）
const englishTemplate =
	markdownBlocks('review-notes.md').find((block) => block.includes('## ✅ Can you recall it?')) ?? '';

describe('書き方ガイドのサンプル', () => {
	it('サンプルがある', () => {
		expect(ja.length).toBeGreaterThan(0);
		expect(en.length).toBeGreaterThan(0);
	});

	it('1. 内蔵の型に「思い出せるか」を含む見出しがある（チェックを外す見出しの既定値と一致）', () => {
		expect(headings(DEFAULT_NOTE_TEMPLATE).some((line) => line.includes('思い出せるか'))).toBe(true);
	});

	it.each(ja)('2. 日本語のサンプル $name の見出しは、内蔵の型と同じ', ({ text }) => {
		expect(headings(text)).toEqual(headings(DEFAULT_NOTE_TEMPLATE));
	});

	it.each(ja)('3. 日本語のサンプル $name の判定表は、内蔵の型と同じ', ({ text }) => {
		expect(tableRows(text)).toEqual(tableRows(DEFAULT_NOTE_TEMPLATE));
	});

	it.each(all)('4. $lang/$name は study-* を含まない（置いただけで登録されない）', ({ text }) => {
		expect(frontmatterKeys(text).filter((key) => key.startsWith('study-'))).toEqual([]);
	});

	it.each(all)('5. $lang/$name はチェックボックスを使わない（内蔵の型と同じ）', ({ text }) => {
		expect(text).not.toMatch(/^\s*[-*+] \[[ xX]\]/m);
	});

	it.each(all)('6. $lang/$name の OK 行はちょうど1つ', ({ text }) => {
		expect(lines(text).filter((line) => line.startsWith('- **OK**'))).toHaveLength(1);
	});

	it('7. 日本語と英語のサンプルが同じファイル名でそろっている', () => {
		expect(en.map((e) => e.name)).toEqual(ja.map((e) => e.name));
	});

	it.each(en)('8. 英語のサンプル $name の判定表に、☆ ◯ △ ✗ の行が1つずつある', ({ text }) => {
		const rows = tableRows(text);
		for (const symbol of ['☆', '◯', '△', '✗']) {
			expect(rows.filter((row) => row.includes(`**${symbol}`))).toHaveLength(1);
		}
	});

	// 以下は agy-review の提案で足した確かめ
	it.each(en)('英語のサンプル $name の見出しと判定表は、ガイドの英語の型と同じ', ({ text }) => {
		expect(headings(englishTemplate)).toHaveLength(2);
		expect(headings(text)).toEqual(headings(englishTemplate));
		expect(tableRows(text)).toEqual(tableRows(englishTemplate));
	});

	it.each(all)('$lang/$name の「なぜ」の行はちょうど1つ', ({ text }) => {
		const why = lines(text).filter((line) => line.startsWith('- **なぜ**') || line.startsWith('- **Why**'));
		expect(why).toHaveLength(1);
	});
});

describe('書き方ガイドの「内蔵の型の全文」', () => {
	it.each(['review-notes.ja.md', 'review-notes.md'])(
		'%s の最初のコードブロックは、内蔵の型と1文字も違わない',
		(path) => {
			expect(markdownBlocks(path)[0]).toBe(DEFAULT_NOTE_TEMPLATE);
		},
	);
});
