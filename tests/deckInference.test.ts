import { describe, expect, it } from 'vitest';
import {
	DeckInput,
	commonParentFolder,
	deckListWarnings,
	inferDecksFromNotes,
	validateDeckInput,
} from '../src/studyCurve/deckInference';
import type { DeckConfig } from '../src/studyCurve/types';

// 設計書 §6.1 の表（#9）

describe('commonParentFolder', () => {
	it('1. 1件なら、その親フォルダ', () => {
		expect(commonParentFolder(['a/b/c.md'])).toBe('a/b');
	});

	it('2. 深さの違うノートは、浅いほうに共通する部分', () => {
		expect(commonParentFolder(['a/b/c.md', 'a/b/d/e.md'])).toBe('a/b');
	});

	it('3. 共通するフォルダがなければ空', () => {
		expect(commonParentFolder(['a/x.md', 'b/y.md'])).toBe('');
	});

	it('4. Vault の直下のノートを含めば空', () => {
		expect(commonParentFolder(['root.md', 'a/b.md'])).toBe('');
		expect(commonParentFolder(['a/b.md', 'root.md'])).toBe('');
	});

	it('5. フォルダ名の単位で比べる（文字列の前方一致ではない）', () => {
		expect(commonParentFolder(['AWS/ANS/x.md', 'AWS/ANS2/y.md'])).toBe('AWS');
	});

	it('6. 0件なら空', () => {
		expect(commonParentFolder([])).toBe('');
	});

	it('7. 日本語のフォルダ名', () => {
		expect(
			commonParentFolder(['資格/応用情報/午後/1.md', '資格/応用情報/午前/2.md']),
		).toBe('資格/応用情報');
	});
});

/** 作者の Vault の実際の分布（2026-09-28 に読み取りで確認）を再現する */
function notesIn(deck: string, folder: string, count: number) {
	return Array.from({ length: count }, (_, i) => ({ deck, filePath: `${folder}/n${i}.md` }));
}

const ANS = [
	...notesIn('AWS ANS', 'AWS_Certifications/ANS/review/domains', 31),
	...notesIn('AWS ANS', 'AWS_Certifications/ANS/review/units', 27),
];
const DOP = [
	...notesIn('AWS DOP', 'AWS_Certifications/DOP', 6),
	...notesIn('AWS DOP', 'AWS_Certifications/DOP/review/domains', 24),
	...notesIn('AWS DOP', 'AWS_Certifications/DOP/review/services', 25),
];

describe('inferDecksFromNotes', () => {
	it('8. AWS ANS は review までが共通', () => {
		expect(inferDecksFromNotes(ANS, [])).toEqual([
			{ name: 'AWS ANS', folder: 'AWS_Certifications/ANS/review', count: 58 },
		]);
	});

	it('9. AWS DOP はデッキのフォルダの直下にもノートがある', () => {
		expect(inferDecksFromNotes(DOP, [])).toEqual([
			{ name: 'AWS DOP', folder: 'AWS_Certifications/DOP', count: 55 },
		]);
	});

	it('10. ANS に review/README.md を足してもフォルダは同じ', () => {
		const notes = [
			...ANS,
			{ deck: 'AWS ANS', filePath: 'AWS_Certifications/ANS/review/README.md' },
		];
		expect(inferDecksFromNotes(notes, [])).toEqual([
			{ name: 'AWS ANS', folder: 'AWS_Certifications/ANS/review', count: 59 },
		]);
	});

	it('11. DOP に review/README.md を足してもフォルダは同じ', () => {
		const notes = [
			...DOP,
			{ deck: 'AWS DOP', filePath: 'AWS_Certifications/DOP/review/README.md' },
		];
		expect(inferDecksFromNotes(notes, [])).toEqual([
			{ name: 'AWS DOP', folder: 'AWS_Certifications/DOP', count: 56 },
		]);
	});

	it('12. 件数の多い順に並ぶ', () => {
		// 並びの入力順に左右されないように、DOP を先に渡す
		expect(inferDecksFromNotes([...DOP, ...ANS], [])).toEqual([
			{ name: 'AWS ANS', folder: 'AWS_Certifications/ANS/review', count: 58 },
			{ name: 'AWS DOP', folder: 'AWS_Certifications/DOP', count: 55 },
		]);
	});

	it('13. 設定にあるデッキは出さない', () => {
		const result = inferDecksFromNotes([...ANS, ...DOP], [{ name: 'AWS DOP' }]);
		expect(result.map((deck) => deck.name)).toEqual(['AWS ANS']);
	});

	it('14. 件数が同じなら名前順', () => {
		const notes = [...notesIn('B', 'b', 2), ...notesIn('A', 'a', 2)];
		expect(inferDecksFromNotes(notes, []).map((deck) => deck.name)).toEqual(['A', 'B']);
	});

	it('15. 0件なら空', () => {
		expect(inferDecksFromNotes([], [])).toEqual([]);
	});

	it('大文字と小文字だけ違う名前は別のデッキ（findDeck と同じ）', () => {
		const notes = [...notesIn('AWS ANS', 'a', 1), ...notesIn('aws ans', 'b', 1)];
		expect(inferDecksFromNotes(notes, [{ name: 'AWS ANS' }])).toEqual([
			{ name: 'aws ans', folder: 'b', count: 1 },
		]);
	});
});

function input(overrides: Partial<DeckInput> = {}): DeckInput {
	return { name: 'TOEIC', folder: '', examDate: '', ...overrides };
}

describe('validateDeckInput', () => {
	it('16. 前後の空白と、フォルダの先頭・末尾の / を取る。試験日の空欄は null', () => {
		expect(
			validateDeckInput({ name: '  TOEIC  ', folder: '/英語/TOEIC/', examDate: '' }, []),
		).toEqual({
			deck: { name: 'TOEIC', folder: '英語/TOEIC', examDate: null },
			errors: [],
		});
	});

	it('17. 名前が空', () => {
		const result = validateDeckInput(input({ name: '   ' }), []);
		expect(result.deck).toBeNull();
		expect(result.errors).toEqual([{ field: 'name', message: '名前を入力してください' }]);
	});

	it('18. 既存のデッキと同じ名前', () => {
		const result = validateDeckInput(input({ name: 'AWS DOP' }), ['AWS DOP']);
		expect(result.deck).toBeNull();
		expect(result.errors).toEqual([{ field: 'name', message: '同じ名前のデッキがあります' }]);
	});

	it('19. 大文字と小文字は区別する', () => {
		const result = validateDeckInput(input({ name: 'aws dop' }), ['AWS DOP']);
		expect(result.errors).toEqual([]);
		expect(result.deck?.name).toBe('aws dop');
	});

	it('20. \\ を / にし、/ の連続を1つにする', () => {
		expect(validateDeckInput(input({ folder: 'a\\b//c' }), []).deck?.folder).toBe('a/b/c');
	});

	it('21. . や .. の区切りを含むフォルダ', () => {
		for (const folder of ['a/../b', './a', 'a/.']) {
			const result = validateDeckInput(input({ folder }), []);
			expect(result.deck).toBeNull();
			expect(result.errors).toEqual([
				{ field: 'folder', message: 'フォルダに「.」「..」は使えません' },
			]);
		}
		// 名前の一部としての . は使える
		expect(validateDeckInput(input({ folder: 'a/.b/c..d' }), []).errors).toEqual([]);
	});

	it('22. 正しい試験日', () => {
		expect(validateDeckInput(input({ examDate: ' 2026-10-25 ' }), []).deck?.examDate).toBe(
			'2026-10-25',
		);
	});

	it('23. 存在しない日付', () => {
		const result = validateDeckInput(input({ examDate: '2026-02-30' }), []);
		expect(result.deck).toBeNull();
		expect(result.errors).toEqual([
			{ field: 'examDate', message: '日付は 2026-10-25 のように入力してください' },
		]);
	});

	it('24. 形の違う日付', () => {
		const result = validateDeckInput(input({ examDate: '2026/10/25' }), []);
		expect(result.errors.map((error) => error.field)).toEqual(['examDate']);
	});

	it('25. エラーが複数あれば全部返し、deck は null', () => {
		const result = validateDeckInput(input({ name: '', examDate: '2026-13-01' }), []);
		expect(result.deck).toBeNull();
		expect(result.errors.map((error) => error.field)).toEqual(['name', 'examDate']);
	});
});

// 設計書 §6.1 の表（#26）

describe('validateDeckInput（編集：呼び出し側が自分の名前を除く）', () => {
	const edit = (name: string): DeckInput => ({ name, folder: '', examDate: '' });

	it('19. 自分を除いた名前に同じものがなければエラーなし', () => {
		expect(validateDeckInput(edit('A'), ['B']).errors).toEqual([]);
	});

	it('20. ほかのデッキと同じ名前はエラー', () => {
		expect(validateDeckInput(edit('B'), ['B']).errors.map((error) => error.message)).toEqual([
			'同じ名前のデッキがあります',
		]);
	});
});

describe('deckListWarnings', () => {
	const deck = (name: string, folder = ''): DeckConfig => ({ name, folder, examDate: null });
	const exists = (folders: string[]) => (folder: string) => folders.includes(folder);
	const kinds = (decks: DeckConfig[], folders: string[] = []) =>
		deckListWarnings(decks, exists(folders)).map((warnings) => warnings.map((w) => w.kind));

	it('11. 名前があり、フォルダが存在するか空なら警告なし', () => {
		expect(kinds([deck('A', 'a'), deck('B')], ['a'])).toEqual([[], []]);
	});

	it('12. 同じ名前は2つ目の行にだけ出す', () => {
		const warnings = deckListWarnings([deck('A'), deck('A')], exists([]));
		expect(warnings[0]).toEqual([]);
		expect(warnings[1]).toEqual([
			{
				kind: 'duplicateName',
				message:
					'同じ名前のデッキが上にあります。試験日はそちらが使われます。名前を変えるか、削除してください。',
			},
		]);
	});

	it('13. 大文字と小文字だけ違う名前は別のデッキ（findDeck と同じ）', () => {
		expect(kinds([deck('A'), deck('a')])).toEqual([[], []]);
	});

	it('14. 空の名前どうしは重複にしない', () => {
		expect(kinds([deck('  '), deck('  ')])).toEqual([['emptyName'], ['emptyName']]);
		expect(deckListWarnings([deck('')], exists([]))[0]?.[0]?.message).toBe(
			'名前が空です。編集して名前を付けてください。',
		);
	});

	it('15. 存在しないフォルダは、そのフォルダ名を出す', () => {
		expect(deckListWarnings([deck('A', 'x/y')], exists([]))).toEqual([
			[{ kind: 'folderMissing', message: 'フォルダ「x/y」が見つかりません。' }],
		]);
	});

	it('16. 名前が空で、フォルダも存在しなければ両方', () => {
		expect(kinds([deck('', 'x')])).toEqual([['emptyName', 'folderMissing']]);
	});
});
