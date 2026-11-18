import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { SELF_CHECK_SECTION } from '../src/studyCurve/noteFile';
import { hasHeadingContaining, insertSelfCheckSection } from '../src/studyCurve/selfCheck';
import { insertSelfCheck } from '../src/studyCurve/studyMutator';

// 既存のノートに「思い出せるか」の空欄と判定表を差し込む（#2）

const S = SELF_CHECK_SECTION;

describe('hasHeadingContaining', () => {
	it('見出しに語を含めば true', () => {
		expect(hasHeadingContaining('# T\n\n## ✅ 思い出せるか（読む前に）\n', '思い出せるか')).toBe(true);
		expect(hasHeadingContaining('### 思い出せるか\n', '思い出せるか')).toBe(true);
	});

	it('見出しでない行、frontmatter、コードブロックの中は見ない', () => {
		expect(hasHeadingContaining('思い出せるか\n', '思い出せるか')).toBe(false);
		expect(hasHeadingContaining('---\ntitle: "# 思い出せるか"\n---\n本文\n', '思い出せるか')).toBe(false);
		expect(hasHeadingContaining('```\n## 思い出せるか\n```\n', '思い出せるか')).toBe(false);
		expect(hasHeadingContaining('~~~~\n## 思い出せるか\n~~~\n~~~~\n', '思い出せるか')).toBe(false);
		expect(hasHeadingContaining('#思い出せるか\n', '思い出せるか')).toBe(false);
	});

	it('コードブロックの後の見出しは見る', () => {
		expect(hasHeadingContaining('```\nx\n```\n## 思い出せるか\n', '思い出せるか')).toBe(true);
	});

	it('大文字と小文字は区別しない', () => {
		expect(hasHeadingContaining('## Recall CHECK\n', 'recall check')).toBe(true);
	});
});

describe('insertSelfCheckSection', () => {
	it('frontmatter とタイトルの後に差し込み、元の本文とのあいだに --- を入れる', () => {
		const content = '---\nstudy-deck: A\n---\n# IAM\n\n本文\n';
		expect(insertSelfCheckSection(content)).toBe(
			`---\nstudy-deck: A\n---\n# IAM\n\n${S}\n---\n\n本文\n`,
		);
	});

	it('タイトルがなければ frontmatter の直後に差し込む', () => {
		expect(insertSelfCheckSection('---\na: 1\n---\n本文\n')).toBe(`---\na: 1\n---\n${S}\n---\n\n本文\n`);
	});

	it('frontmatter もタイトルもなければ先頭に差し込む', () => {
		expect(insertSelfCheckSection('本文\n')).toBe(`${S}\n---\n\n本文\n`);
	});

	it('frontmatter の後の空行を飛ばしてタイトルを探す', () => {
		expect(insertSelfCheckSection('---\na: 1\n---\n\n# T\n本文')).toBe(
			`---\na: 1\n---\n\n# T\n\n${S}\n---\n\n本文`,
		);
	});

	it('2段目以下の見出しはタイトルとみなさない', () => {
		expect(insertSelfCheckSection('## 節\n本文\n')).toBe(`${S}\n---\n\n## 節\n本文\n`);
	});

	it('本文がタイトルだけなら、--- を入れない', () => {
		expect(insertSelfCheckSection('# T')).toBe(`# T\n\n${S}`);
		expect(insertSelfCheckSection('# T\n\n\n')).toBe(`# T\n\n${S}`);
	});

	it('空のノートには欄だけを入れる', () => {
		expect(insertSelfCheckSection('')).toBe(S);
	});

	it('もう欄があれば null', () => {
		expect(insertSelfCheckSection(`# T\n\n${S}`)).toBeNull();
		expect(insertSelfCheckSection('# T\n\n## 思い出せるか\n- [ ] a\n')).toBeNull();
	});

	it('差し込んだあとにもう一度呼ぶと null（二重に入れない）', () => {
		const once = insertSelfCheckSection('# T\n\n本文\n');
		expect(once).not.toBeNull();
		expect(insertSelfCheckSection(once!)).toBeNull();
	});

	it('CRLF のノートには CRLF で差し込み、元の行は変えない', () => {
		const content = '---\r\na: 1\r\n---\r\n# T\r\n\r\n本文\r\n';
		const result = insertSelfCheckSection(content)!;
		expect(result).toBe(`---\r\na: 1\r\n---\r\n# T\r\n\r\n${S.replace(/\n/g, '\r\n')}\r\n---\r\n\r\n本文\r\n`);
		expect(result.replace(/\r\n/g, '')).not.toMatch(/\n/);
	});
});

describe('insertSelfCheck', () => {
	/** vault.read と vault.process だけの偽物。beforeProcess で、読んだあと・書く前の編集を再現する */
	function fakeApp(initial: string, beforeProcess?: (body: string) => string) {
		const state = { body: initial, writes: 0 };
		const app = {
			vault: {
				read: async () => state.body,
				process: async (_file: TFile, fn: (data: string) => string) => {
					if (beforeProcess) state.body = beforeProcess(state.body);
					const next = fn(state.body);
					if (next !== state.body) state.writes++;
					state.body = next;
					return next;
				},
			},
		};
		return { app: app as never, state };
	}

	it('欄がなければ差し込んで true', async () => {
		const { app, state } = fakeApp('# T\n\n本文\n');
		expect(await insertSelfCheck(app, new TFile())).toBe(true);
		expect(state.body).toBe(`# T\n\n${S}\n---\n\n本文\n`);
	});

	it('もう欄があれば書き込まずに false', async () => {
		const { app, state } = fakeApp(`# T\n\n${S}`);
		expect(await insertSelfCheck(app, new TFile())).toBe(false);
		expect(state.writes).toBe(0);
	});

	it('読んだあとに欄が足されていたら、本文を変えない', async () => {
		const added = `# T\n\n## 思い出せるか\n`;
		const { app, state } = fakeApp('# T\n', () => added);
		await insertSelfCheck(app, new TFile());
		expect(state.body).toBe(added);
		expect(state.writes).toBe(0);
	});

	it('読んだあとの編集は残して差し込む', async () => {
		const { app, state } = fakeApp('# T\n\n本文\n', (body) => `${body}追記\n`);
		await insertSelfCheck(app, new TFile());
		expect(state.body).toBe(`# T\n\n${S}\n---\n\n本文\n追記\n`);
	});
});
