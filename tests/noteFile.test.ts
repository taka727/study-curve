import { describe, expect, it } from 'vitest';
import {
	DEFAULT_NOTE_TEMPLATE,
	joinPath,
	renderTemplate,
	sanitizeFileName,
	uniquePath,
} from '../src/studyCurve/noteFile';

// 設計書 §6.1 の表（#10）

describe('sanitizeFileName', () => {
	it('1. 使える文字だけならそのまま', () => {
		expect(sanitizeFileName('IAM のポリシー評価')).toBe('IAM のポリシー評価');
	});

	it('2. / は空白にする', () => {
		expect(sanitizeFileName('A/B の違い')).toBe('A B の違い');
	});

	it('3. OS で使えない記号は空白にし、空白の連続を1つにする', () => {
		expect(sanitizeFileName('What? <tag> "x" | y')).toBe('What tag x y');
	});

	it('4. Obsidian のリンクで意味を持つ記号も空白にする', () => {
		expect(sanitizeFileName('#tag ^block [[link]]')).toBe('tag block link');
	});

	it('5. : と * も空白にする', () => {
		expect(sanitizeFileName('a:b*c')).toBe('a b c');
	});

	it('6. 先頭の . を取る', () => {
		expect(sanitizeFileName('...hidden')).toBe('hidden');
	});

	it('7. 末尾の . を取る（全角の句点は残す）', () => {
		expect(sanitizeFileName('末尾の点。...')).toBe('末尾の点。');
	});

	it('8. 前後の空白を取る', () => {
		expect(sanitizeFileName('  前後の空白  ')).toBe('前後の空白');
	});

	it('9. 改行などの制御文字は空白にする', () => {
		expect(sanitizeFileName('改行\nを含む')).toBe('改行 を含む');
	});

	it('9b. ノーブレークスペースは空白にする（normalizePath と同じ。重複の確認と作るパスをそろえる）', () => {
		expect(sanitizeFileName('IAM\u00A0\u00A0Policy\u202F')).toBe('IAM Policy');
	});

	it('10. 使える文字が残らなければ空文字', () => {
		expect(sanitizeFileName('???')).toBe('');
	});

	it('11. Windows の予約名には _ を足す（大文字と小文字を問わない）', () => {
		expect(sanitizeFileName('CON')).toBe('CON_');
		expect(sanitizeFileName('lpt1')).toBe('lpt1_');
	});

	it('11b. 拡張子のように . が続いても予約名として扱う（CON.md も使えないため）', () => {
		expect(sanitizeFileName('con.foo')).toBe('con_.foo');
		expect(sanitizeFileName('COM10')).toBe('COM10');
	});

	it('12. UTF-8 で 180 バイトを超えたら切り詰める（日本語なら60文字）', () => {
		expect(sanitizeFileName('あ'.repeat(100))).toBe('あ'.repeat(60));
	});

	it('13. サロゲートペアを分けずに切り詰める', () => {
		expect(sanitizeFileName('😀'.repeat(50))).toBe('😀'.repeat(45));
	});

	it('14. 濁点が分かれた形は NFC にまとめる', () => {
		expect(sanitizeFileName('が')).toBe('が');
	});

	it('15. 切り詰めた末尾の空白も取る', () => {
		expect(sanitizeFileName(`${'a'.repeat(179)} b`, 180)).toBe('a'.repeat(179));
	});
});

describe('uniquePath', () => {
	const existing = (paths: string[]) => (path: string) => paths.includes(path);

	it('16. どれも存在しなければそのまま', () => {
		expect(uniquePath('A', 'x', 'md', existing([]))).toBe('A/x.md');
	});

	it('17. 存在すれば 1 を付ける', () => {
		expect(uniquePath('A', 'x', 'md', existing(['A/x.md']))).toBe('A/x 1.md');
	});

	it('18. 1 も存在すれば 2 を付ける', () => {
		expect(uniquePath('A', 'x', 'md', existing(['A/x.md', 'A/x 1.md']))).toBe('A/x 2.md');
	});

	it('19. フォルダが空ならファイル名だけ', () => {
		expect(uniquePath('', 'x', 'md', existing([]))).toBe('x.md');
	});

	it('20. 番号が上限を超えたら例外', () => {
		expect(() => uniquePath('A', 'x', 'md', () => true, 3)).toThrow();
	});
});

describe('renderTemplate', () => {
	const vars = { title: 'IAM', deck: 'AWS DOP', date: '2026-10-04' };

	it('21. {{title}} を置き換える', () => {
		expect(renderTemplate('# {{title}}', vars)).toBe('# IAM');
	});

	it('22. 中括弧の内側の空白は許す', () => {
		expect(renderTemplate('{{ title }} {{date }}', vars)).toBe('IAM 2026-10-04');
	});

	it('23. 同じ変数が2回あれば両方置き換える', () => {
		expect(renderTemplate('{{deck}} / {{deck}}', vars)).toBe('AWS DOP / AWS DOP');
	});

	it('24. 知らない変数はそのまま', () => {
		expect(renderTemplate('{{foo}}', vars)).toBe('{{foo}}');
	});

	it('25. 置き換えた値の中の変数はもう一度展開しない', () => {
		expect(renderTemplate('{{title}}', { ...vars, title: '{{deck}}' })).toBe('{{deck}}');
	});

	it('26. 値に $& を含んでもそのまま入る', () => {
		expect(renderTemplate('{{title}}', { ...vars, title: 'a$&b' })).toBe('a$&b');
	});

	it('27. Templater の構文はそのまま', () => {
		expect(renderTemplate('<% tp.file.title %>', vars)).toBe('<% tp.file.title %>');
	});

	it('28. 内蔵の型に「思い出せるか」を含む見出しがある（#20 の既定の見出しと一致）', () => {
		expect(DEFAULT_NOTE_TEMPLATE).toMatch(/^##[^\n]*思い出せるか/m);
	});
});

describe('joinPath', () => {
	it('29. フォルダが空ならファイル名だけ', () => {
		expect(joinPath('', 'x.md')).toBe('x.md');
	});

	it('30. フォルダとファイル名を / でつなぐ', () => {
		expect(joinPath('a/b', 'x.md')).toBe('a/b/x.md');
	});
});
