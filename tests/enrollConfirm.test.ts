import { describe, expect, it } from 'vitest';
import { EnrollConfirmInput, buildEnrollConfirm } from '../src/studyCurve/enrollConfirm';

// 設計書 §6.1 の表（#21）

function paths(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `AWS/DOP/review/n${i}.md`);
}

function input(overrides: Partial<EnrollConfirmInput> = {}): EnrollConfirmInput {
	return {
		deckName: 'AWS DOP',
		deckFolder: 'AWS/DOP',
		filePaths: paths(3),
		scope: { kind: 'deck', filter: '' },
		firstReviewLabel: '9/29(火)',
		...overrides,
	};
}

describe('buildEnrollConfirm', () => {
	it('1. デッキ単位・3件・絞り込みなし', () => {
		const options = buildEnrollConfirm(input());
		expect(options.title).toBe('まとめて登録');
		expect(options.details).toHaveLength(3);
		expect(options.moreCount).toBe(0);
		expect(options.confirmLabel).toBe('3 件を登録');
		expect(options.warning).toBe(false);
		expect(options.message).toBe(
			'「AWS DOP」の未登録ノート 3 件を復習対象に登録します。' +
				'各ノートの frontmatter に study-deck・study-stage・study-next・study-history を書き込みます。' +
				'初回の復習日はすべて 9/29(火) です。',
		);
	});

	it('2. デッキ単位・124件なら先頭5件と「ほか 119 件」', () => {
		const options = buildEnrollConfirm(input({ filePaths: paths(124) }));
		expect(options.details).toEqual([
			'review/n0',
			'review/n1',
			'review/n2',
			'review/n3',
			'review/n4',
		]);
		expect(options.moreCount).toBe(119);
		expect(options.confirmLabel).toBe('124 件を登録');
	});

	it('3. 絞り込み中は、絞り込みの文字を本文に入れる', () => {
		const options = buildEnrollConfirm(input({ scope: { kind: 'deck', filter: '0819' } }));
		expect(options.title).toBe('まとめて登録');
		expect(options.message).toContain('絞り込み「0819」に一致するフォルダの');
		expect(options.message).toMatch(
			/^「AWS DOP」の未登録ノートのうち、絞り込み「0819」に一致するフォルダの 3 件を復習対象に登録します。各ノートの/,
		);
	});

	it('3b. 絞り込みが空白だけなら、絞り込みなしと同じ文言', () => {
		const options = buildEnrollConfirm(input({ scope: { kind: 'deck', filter: '  ' } }));
		expect(options.message).toMatch(/^「AWS DOP」の未登録ノート 3 件を/);
	});

	it('4. フォルダ単位・デッキ直下なら「（直下）」', () => {
		const options = buildEnrollConfirm(
			input({ filePaths: ['AWS/DOP/a.md', 'AWS/DOP/b.md'], scope: { kind: 'folder', dir: '' } }),
		);
		expect(options.title).toBe('フォルダ内を登録');
		expect(options.message).toContain('「（直下）」');
		expect(options.message).toMatch(/^「AWS DOP」の「（直下）」にある未登録ノート 2 件を復習対象に登録します。/);
		expect(options.confirmLabel).toBe('2 件を登録');
		expect(options.warning).toBe(false);
	});

	it('4b. フォルダ単位・サブフォルダならその名前', () => {
		const options = buildEnrollConfirm(input({ scope: { kind: 'folder', dir: 'review' } }));
		expect(options.message).toContain('「AWS DOP」の「review」にある未登録ノート 3 件');
	});

	it('5. 一覧はデッキのフォルダからの相対パスで、.md を付けない', () => {
		const options = buildEnrollConfirm(input({ filePaths: ['AWS/DOP/review/a.md'] }));
		expect(options.details).toEqual(['review/a']);
	});

	it('5b. デッキのフォルダの末尾に / があっても相対化する', () => {
		const options = buildEnrollConfirm(
			input({ deckFolder: 'AWS/DOP/', filePaths: ['AWS/DOP/review/a.md'] }),
		);
		expect(options.details).toEqual(['review/a']);
	});

	it('6. デッキのフォルダの外のパスは相対化しない', () => {
		const options = buildEnrollConfirm(
			input({ filePaths: ['Other/x.md', 'AWS/DOPX/y.md'] }),
		);
		expect(options.details).toEqual(['Other/x', 'AWS/DOPX/y']);
	});
});
