import { describe, expect, it } from 'vitest';
import { clearChecksInSection, splitLines } from '../src/studyCurve/checkboxes';

const KEYWORD = '思い出せるか';

interface Case {
	no: number;
	title: string;
	input: string;
	/** 省略したら変化なし（入力と同じ文字列） */
	expected?: string;
	keyword?: string;
}

/** #31 他の人のタスク管理のノート。思い出せるかの見出しがないので、1文字も変えない */
const TASK_NOTE = [
	'---',
	'tags: [project]',
	'status: active',
	'---',
	'',
	'# 案件 A',
	'',
	'## タスク',
	'- [x] 見積もりを提出 ✅ 2026-09-01',
	'- [ ] 設計レビュー 📅 2026-10-01',
	'  - [x] 資料の準備',
	'1. [x] キックオフ',
	'',
	'## メモ',
	'> [!todo] 残件',
	'> - [x] 議事録を送る',
	'',
	'```tasks',
	'done',
	'```',
	'',
].join('\n');

// 設計書 #20 §6.1 の表。特記がなければ keyword は「思い出せるか」
const CASES: Case[] = [
	{
		no: 1,
		title: 'keyword が空なら何もしない',
		input: '## 思い出せるか\n- [x] a',
		keyword: '',
	},
	{
		no: 2,
		title: '基本。大文字の X も外す',
		input: '## 思い出せるか\n- [x] a\n- [X] b\n',
		expected: '## 思い出せるか\n- [ ] a\n- [ ] b\n',
	},
	{ no: 3, title: '対象外の見出し', input: '## メモ\n- [x] a\n' },
	{
		no: 4,
		title: '見出しより前は対象外',
		input: '- [x] a\n## 思い出せるか\n- [x] b',
		expected: '- [x] a\n## 思い出せるか\n- [ ] b',
	},
	{
		no: 5,
		title: '同じレベルの見出しで終わる',
		input: '## 思い出せるか\n- [x] a\n## 答え\n- [x] b\n',
		expected: '## 思い出せるか\n- [ ] a\n## 答え\n- [x] b\n',
	},
	{
		no: 6,
		title: '深い見出しでは終わらない',
		input: '## 思い出せるか\n### 例1\n- [x] a\n',
		expected: '## 思い出せるか\n### 例1\n- [ ] a\n',
	},
	{
		no: 7,
		title: '上のレベルの見出しで終わる',
		input: '### 思い出せるか\n- [x] a\n## 次\n- [x] b',
		expected: '### 思い出せるか\n- [ ] a\n## 次\n- [x] b',
	},
	{
		no: 8,
		title: '中身のない見出しでも終わる',
		input: '## 思い出せるか\n- [x] a\n##\n- [x] b',
		expected: '## 思い出せるか\n- [ ] a\n##\n- [x] b',
	},
	{
		no: 9,
		title: '複数のセクション',
		input: '## 思い出せるか\n- [x] a\n## 思い出せるか 2\n- [x] b',
		expected: '## 思い出せるか\n- [ ] a\n## 思い出せるか 2\n- [ ] b',
	},
	{
		no: 10,
		title: 'frontmatter は対象外',
		input: '---\ntags:\n  - [x]\n---\n## 思い出せるか\n- [x] a',
		expected: '---\ntags:\n  - [x]\n---\n## 思い出せるか\n- [ ] a',
	},
	{
		no: 11,
		title: 'frontmatter の YAML のコメントを見出しとみなさない',
		input: '---\n# 思い出せるか\n---\n- [x] a',
	},
	{
		no: 12,
		title: '閉じていない frontmatter は本文として読む（一致する見出しはない）',
		input: '---\na: 1\n- [x] a',
	},
	{
		no: 13,
		title: 'CRLF を保つ',
		input: '## 思い出せるか\r\n- [x] a\r\n',
		expected: '## 思い出せるか\r\n- [ ] a\r\n',
	},
	{
		no: 14,
		title: '改行コードの混在を行ごとに保つ',
		input: '## 思い出せるか\n- [x] a\r\n- [x] b\r- [x] c',
		expected: '## 思い出せるか\n- [ ] a\r\n- [ ] b\r- [ ] c',
	},
	{
		no: 15,
		title: '最終行に改行がない',
		input: '## 思い出せるか\n- [x] a',
		expected: '## 思い出せるか\n- [ ] a',
	},
	{
		no: 16,
		title: 'コードブロックの中は対象外',
		input: '## 思い出せるか\n```md\n- [x] code\n```\n- [x] a',
		expected: '## 思い出せるか\n```md\n- [x] code\n```\n- [ ] a',
	},
	{
		no: 17,
		title: '開きより短い閉じでは閉じない',
		input: '## 思い出せるか\n~~~~\n- [x] 1\n~~~\n- [x] 2\n~~~~\n- [x] 3',
		expected: '## 思い出せるか\n~~~~\n- [x] 1\n~~~\n- [x] 2\n~~~~\n- [ ] 3',
	},
	{
		no: 18,
		title: 'コードブロックの中の # は見出しではない',
		input: '## 思い出せるか\n```\n## 別\n```\n- [x] a',
		expected: '## 思い出せるか\n```\n## 別\n```\n- [ ] a',
	},
	{
		no: 19,
		title: '字下げされたコードブロックも対象外',
		input: '## 思い出せるか\n- [x] a\n    ```\n    - [x] b\n    ```\n- [x] c',
		expected: '## 思い出せるか\n- [ ] a\n    ```\n    - [x] b\n    ```\n- [ ] c',
	},
	{
		no: 20,
		title: '* と + の記号、番号付きのリスト',
		input: '## 思い出せるか\n* [x] a\n+ [x] b\n1. [x] c\n2) [x] d',
		expected: '## 思い出せるか\n* [ ] a\n+ [ ] b\n1. [ ] c\n2) [ ] d',
	},
	{
		no: 21,
		title: '入れ子（タブと空白の字下げ）',
		input: '## 思い出せるか\n- [ ] 親\n\t- [x] 子\n    - [x] 孫',
		expected: '## 思い出せるか\n- [ ] 親\n\t- [ ] 子\n    - [ ] 孫',
	},
	{
		no: 22,
		title: '独自の状態は対象外',
		input: '## 思い出せるか\n- [-] a\n- [>] b\n- [/] c',
	},
	{
		no: 23,
		title: 'タスクでないもの',
		input: '## 思い出せるか\n- [x]a\n本文 [x] b\n[x] c',
	},
	{
		no: 24,
		title: '引用とコールアウトの中',
		input: '## 思い出せるか\n> - [x] a\n> > - [x] b\n> [!note]\n> - [x] c',
		expected: '## 思い出せるか\n> - [ ] a\n> > - [ ] b\n> [!note]\n> - [ ] c',
	},
	{
		no: 25,
		title: '大文字と小文字を区別しない',
		input: '## recall check\n- [x] a',
		keyword: 'Recall',
		expected: '## recall check\n- [ ] a',
	},
	{
		no: 26,
		title: '閉じの # 付きの見出し',
		input: '## 思い出せるか ##\n- [x] a',
		expected: '## 思い出せるか ##\n- [ ] a',
	},
	{ no: 27, title: '# の後に空白がないのは見出しではない', input: '##思い出せるか\n- [x] a' },
	{ no: 28, title: '4文字以上の字下げは見出しではない', input: '    ## 思い出せるか\n- [x] a' },
	{ no: 29, title: 'setext 見出しは扱わない', input: '思い出せるか\n=====\n- [x] a' },
	{
		no: 30,
		title: '区切り線ではセクションは終わらない',
		input: '## 思い出せるか\n- [x] a\n\n---\n\n- [x] b',
		expected: '## 思い出せるか\n- [ ] a\n\n---\n\n- [ ] b',
	},
	{ no: 31, title: '他の人のタスク管理のノートを1文字も変えない', input: TASK_NOTE },
	// #32 は下の「変化がないときは入力と同じ文字列を返す」で、表の変化なしのケースすべてに対して確かめる
	{ no: 33, title: '空のノート', input: '' },
];

describe('clearChecksInSection', () => {
	it.each(CASES)('#$no $title', ({ input, expected, keyword }) => {
		expect(clearChecksInSection(input, keyword ?? KEYWORD)).toBe(expected ?? input);
	});

	it('#31 のノートの末尾に思い出せるかのセクションを足すと、自己チェックの1行だけが変わる', () => {
		const input = `${TASK_NOTE}## 思い出せるか\n- [x] 自己チェック\n`;
		const output = clearChecksInSection(input, KEYWORD);
		const before = input.split('\n');
		const after = output.split('\n');
		expect(after).toHaveLength(before.length);
		const diff = before.flatMap((line, i) => (line === after[i] ? [] : [[line, after[i]]]));
		expect(diff).toEqual([['- [x] 自己チェック', '- [ ] 自己チェック']]);
	});

	it('#32 変化がないときは入力と同じ文字列を返す（事前の確認で書き込みを避けられる）', () => {
		const unchanged = CASES.filter((c) => c.expected === undefined);
		expect(unchanged.length).toBeGreaterThan(0);
		for (const { input, keyword } of unchanged) {
			expect(clearChecksInSection(input, keyword ?? KEYWORD) === input).toBe(true);
		}
	});

	it('keyword が空白だけなら何もしない', () => {
		const input = '## 思い出せるか\n- [x] a';
		expect(clearChecksInSection(input, '  ')).toBe(input);
	});

	it('keyword の前後の空白は無視する', () => {
		expect(clearChecksInSection('## 思い出せるか\n- [x] a', ' 思い出せるか ')).toBe(
			'## 思い出せるか\n- [ ] a',
		);
	});

	it('内蔵テンプレートの見出し（絵文字と補足付き）に一致する', () => {
		expect(clearChecksInSection('## ✅ 思い出せるか（読む前に）\n- [x] a\n', KEYWORD)).toBe(
			'## ✅ 思い出せるか（読む前に）\n- [ ] a\n',
		);
	});

	it('閉じていないコードブロックは末尾までコードブロックとみなす', () => {
		const input = '## 思い出せるか\n```\n- [x] a\n## 別\n- [x] b';
		expect(clearChecksInSection(input, KEYWORD)).toBe(input);
	});

	it('~~~ で開いたブロックは ``` では閉じない', () => {
		const input = '## 思い出せるか\n~~~\n```\n- [x] a\n~~~\n- [x] b';
		expect(clearChecksInSection(input, KEYWORD)).toBe(
			'## 思い出せるか\n~~~\n```\n- [x] a\n~~~\n- [ ] b',
		);
	});

	it('情報文字列にバッククォートを含む行はコードブロックの開きではない', () => {
		expect(clearChecksInSection('## 思い出せるか\n``` `a`\n- [x] a', KEYWORD)).toBe(
			'## 思い出せるか\n``` `a`\n- [ ] a',
		);
	});

	it('引用・コールアウトの中のコードブロックは対象外', () => {
		expect(
			clearChecksInSection(
				'## 思い出せるか\n> [!note]\n> ```md\n> - [x] example\n> ```\n> - [x] a',
				KEYWORD,
			),
		).toBe('## 思い出せるか\n> [!note]\n> ```md\n> - [x] example\n> ```\n> - [ ] a');
	});

	it('引用が終わると、その中のコードブロックも終わる', () => {
		expect(clearChecksInSection('## 思い出せるか\n> ```\n> - [x] code\n- [x] a', KEYWORD)).toBe(
			'## 思い出せるか\n> ```\n> - [x] code\n- [ ] a',
		);
	});

	it('引用の外で開いたコードブロックは、> の付いた ``` では閉じない', () => {
		expect(
			clearChecksInSection('## 思い出せるか\n```\n> ```\n- [x] code\n```\n- [x] a', KEYWORD),
		).toBe('## 思い出せるか\n```\n> ```\n- [x] code\n```\n- [ ] a');
	});

	it('字下げ（4文字以上）だけで表したコードブロックは対象外', () => {
		expect(
			clearChecksInSection(
				'## 思い出せるか\n- [x] a\n\n例：\n\n    - [x] 例\n\n    - [x] 例2\n- [x] b',
				KEYWORD,
			),
		).toBe('## 思い出せるか\n- [ ] a\n\n例：\n\n    - [x] 例\n\n    - [x] 例2\n- [ ] b');
	});

	it('見出しの直後やタブの字下げも、字下げのコードブロック', () => {
		const input = '## 思い出せるか\n    - [x] 例\n\n\t- [x] 例2';
		expect(clearChecksInSection(input, KEYWORD)).toBe(input);
	});

	it('リストの中の字下げは、空行の後でも入れ子の項目として外す', () => {
		expect(clearChecksInSection('## 思い出せるか\n- [ ] 親\n\n    - [x] 子', KEYWORD)).toBe(
			'## 思い出せるか\n- [ ] 親\n\n    - [ ] 子',
		);
	});

	it('リストの直後の字下げのないコードブロックでリストは終わり、その後の字下げはコードブロック', () => {
		expect(
			clearChecksInSection('## 思い出せるか\n- [x] a\n```\ncode\n```\n\n    - [x] 例\n- [x] b', KEYWORD),
		).toBe('## 思い出せるか\n- [ ] a\n```\ncode\n```\n\n    - [x] 例\n- [ ] b');
	});

	it('リストの直後の字下げのない引用でもリストは終わる', () => {
		expect(clearChecksInSection('## 思い出せるか\n- [x] a\n> 引用\n\n    - [x] 例', KEYWORD)).toBe(
			'## 思い出せるか\n- [ ] a\n> 引用\n\n    - [x] 例',
		);
	});

	it('項目の中に字下げして書いたコードブロックの後は、リストの中のまま', () => {
		expect(
			clearChecksInSection('## 思い出せるか\n- [x] a\n  ```\n  code\n  ```\n\n    - [x] 子', KEYWORD),
		).toBe('## 思い出せるか\n- [ ] a\n  ```\n  code\n  ```\n\n    - [ ] 子');
	});

	it('CRLF の frontmatter を本文とみなさない', () => {
		const input = '---\r\ntags:\r\n  - [x]\r\n---\r\n## 思い出せるか\r\n- [x] a\r\n';
		expect(clearChecksInSection(input, KEYWORD)).toBe(
			'---\r\ntags:\r\n  - [x]\r\n---\r\n## 思い出せるか\r\n- [ ] a\r\n',
		);
	});
});

describe('splitLines', () => {
	it('#1〜#33 のすべての入力で、つなぎ直すと元の文字列に戻る', () => {
		const inputs = [...CASES.map((c) => c.input), `${TASK_NOTE}## 思い出せるか\n- [x] 自己チェック\n`];
		for (const input of inputs) {
			expect(
				splitLines(input)
					.map((l) => l.text + l.eol)
					.join(''),
			).toBe(input);
		}
	});

	it('改行コードを行ごとに分けて持つ。CRLF は1つの改行', () => {
		expect(splitLines('a\r\nb\rc\nd')).toEqual([
			{ text: 'a', eol: '\r\n' },
			{ text: 'b', eol: '\r' },
			{ text: 'c', eol: '\n' },
			{ text: 'd', eol: '' },
		]);
	});

	it('空行を落とさず、末尾の改行の後に空の行を作らない', () => {
		expect(splitLines('\n\na\n')).toEqual([
			{ text: '', eol: '\n' },
			{ text: '', eol: '\n' },
			{ text: 'a', eol: '\n' },
		]);
	});

	it('空の文字列は行なし', () => {
		expect(splitLines('')).toEqual([]);
	});
});
