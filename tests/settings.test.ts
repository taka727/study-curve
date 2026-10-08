import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettingsData, mergeSettings } from '../src/settings';

// 設計書 §6.1 の表（#9 の完了条件8：デッキの追加や削除で DEFAULT_SETTINGS が書き換わらない）

describe('mergeSettings', () => {
	it('1. 保存がなければ既定値と同じ値。decks は既定値とは別の配列', () => {
		const settings = mergeSettings(null);
		expect(settings).toEqual(DEFAULT_SETTINGS);
		expect(settings.decks).toEqual([]);
		expect(settings.decks).not.toBe(DEFAULT_SETTINGS.decks);
		expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it('2. 戻り値の decks に追加しても既定値は空のまま', () => {
		const settings = mergeSettings(null);
		settings.decks.push({ name: 'A', folder: 'a', examDate: null });
		expect(DEFAULT_SETTINGS.decks).toEqual([]);
		expect(mergeSettings(null).decks).toEqual([]);
	});

	it('3. 保存値の decks を使い、ほかの項目は既定値', () => {
		const decks = [{ name: 'A', folder: 'a', examDate: null }];
		const settings = mergeSettings({ decks });
		expect(settings.decks).toEqual(decks);
		expect(settings.dailyLimit).toBe(DEFAULT_SETTINGS.dailyLimit);
		expect(settings.intervalsRaw).toBe(DEFAULT_SETTINGS.intervalsRaw);
	});

	it('4. decks が配列でなければ空の配列', () => {
		expect(mergeSettings({ decks: 'broken' }).decks).toEqual([]);
		expect(mergeSettings({ decks: null }).decks).toEqual([]);
	});

	it('5. 保存値の項目を使い、未知のキーは残す', () => {
		const settings = mergeSettings({ dailyLimit: 5, unknownKey: 1 });
		expect(settings.dailyLimit).toBe(5);
		expect((settings as unknown as Record<string, unknown>)['unknownKey']).toBe(1);
	});

	it('保存値がオブジェクトでなければ既定値', () => {
		expect(mergeSettings('broken')).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
	});
});

// 設計書 §6.1 の #11〜#26（#27 の整える処理と読み込みの入り口）

/** P1 の時点の形（版の番号なし） */
const P1_SAVED = {
	decks: [
		{ name: 'AWS ANS', folder: 'AWS/ANS', examDate: '2026-11-20' },
		{ name: 'AWS DOP', folder: 'AWS/DOP', examDate: null },
	],
	intervalsRaw: '1, 3, 7, 14, 30, 60',
	finalSprintDays: 7,
	dailyLimit: 20,
	forecastDays: 14,
	autoAdvance: true,
	clearChecksOnGrade: false,
	checkSectionHeading: '思い出せるか',
	noteTemplatePath: 'Templates/復習.md',
};

/** P1 より前の形（clearChecksOnGrade を ON で保存、#20・#10 の項目なし） */
const BEFORE_P1_SAVED = {
	decks: [{ name: 'AWS ANS', folder: 'AWS/ANS', examDate: null }],
	intervalsRaw: '1, 3, 7, 14, 30, 60',
	finalSprintDays: 7,
	dailyLimit: 20,
	forecastDays: 14,
	autoAdvance: true,
	clearChecksOnGrade: true,
};

const BROKEN_DECKS = [
	null,
	'x',
	{ folder: 'a' },
	{ name: ' A ', folder: ' a/b ', examDate: '2026-10-25' },
];

const INTEGER_BROKEN = { dailyLimit: 'abc', forecastDays: 0, finalSprintDays: 3 };

const WITH_UNKNOWN = {
	foo: 1,
	decks: [{ name: 'A', folder: '', examDate: null, color: 'red' }],
};

describe('loadSettingsData（整える処理）', () => {
	it('11. 保存がなければ既定値と同じ値。decks は既定値とは別の配列', () => {
		const { settings, savedVersion, newer, invalid, resetKeys } = loadSettingsData(null);
		expect(settings).toEqual(DEFAULT_SETTINGS);
		expect(settings.decks).not.toBe(DEFAULT_SETTINGS.decks);
		expect({ savedVersion, newer, invalid, resetKeys }).toEqual({
			savedVersion: null,
			newer: false,
			invalid: false,
			resetKeys: [],
		});
	});

	it('12. P1 より前の形：ON の clearChecksOnGrade は残り、足りない項目は既定値', () => {
		const { settings, savedVersion, resetKeys } = loadSettingsData(BEFORE_P1_SAVED);
		expect(savedVersion).toBe(0);
		expect(settings.version).toBe(1);
		expect(settings.clearChecksOnGrade).toBe(true);
		expect(settings.checkSectionHeading).toBe('思い出せるか');
		expect(settings.noteTemplatePath).toBe('');
		expect(settings.decks).toEqual(BEFORE_P1_SAVED.decks);
		// 書かれていない項目を補っただけなので、既定値に戻した項目には数えない
		expect(resetKeys).toEqual([]);
	});

	it('P1 の時点の形は、version 以外が保存値のまま', () => {
		expect(loadSettingsData(P1_SAVED).settings).toEqual({ ...P1_SAVED, version: 1 });
	});

	it('13. 整数の項目は、その項目だけ既定値に戻す', () => {
		const { settings, resetKeys } = loadSettingsData(INTEGER_BROKEN);
		expect(settings.dailyLimit).toBe(20);
		expect(settings.forecastDays).toBe(14);
		expect(settings.finalSprintDays).toBe(3);
		expect(resetKeys).toEqual(['dailyLimit', 'forecastDays']);
	});

	it('14. 負、小数、数字の文字列は既定値', () => {
		for (const dailyLimit of [-1, 2.5, '5']) {
			expect(loadSettingsData({ dailyLimit }).settings.dailyLimit).toBe(20);
		}
		// 下限ちょうどは正しい値（0 は無制限）
		expect(loadSettingsData({ dailyLimit: 0 }).settings.dailyLimit).toBe(0);
	});

	it('15. 真偽値でなければ既定値', () => {
		expect(loadSettingsData({ autoAdvance: 'yes' }).settings.autoAdvance).toBe(true);
	});

	it('16. decks が配列でなければ空の配列', () => {
		const { settings, resetKeys } = loadSettingsData({ decks: 'broken' });
		expect(settings.decks).toEqual([]);
		expect(resetKeys).toEqual(['decks']);
	});

	it('17. 名前のない要素は捨て、名前とフォルダの前後の空白を取る', () => {
		const { settings, resetKeys } = loadSettingsData({ decks: BROKEN_DECKS });
		expect(settings.decks).toEqual([{ name: 'A', folder: 'a/b', examDate: '2026-10-25' }]);
		expect(resetKeys).toEqual(['decks[0]', 'decks[1]', 'decks[2]']);
	});

	it('18. 文字列でないフォルダは空、存在しない試験日は未設定', () => {
		const { settings, resetKeys } = loadSettingsData({
			decks: [{ name: 'A', folder: 1, examDate: '2026-02-30' }],
		});
		expect(settings.decks).toEqual([{ name: 'A', folder: '', examDate: null }]);
		expect(resetKeys).toEqual(['decks[0].folder', 'decks[0].examDate']);
		expect(
			loadSettingsData({ decks: [{ name: 'A', folder: '', examDate: '2026/10/25' }] }).settings
				.decks[0]?.examDate,
		).toBeNull();
	});

	it('19. 同じ名前のデッキは2件とも残す', () => {
		const decks = [
			{ name: 'A', folder: 'a', examDate: null },
			{ name: 'A', folder: 'b', examDate: null },
		];
		expect(loadSettingsData({ decks }).settings.decks).toEqual(decks);
	});

	it('20. 空の名前のデッキは残す', () => {
		const decks = [{ name: '', folder: '', examDate: null }];
		expect(loadSettingsData({ decks }).settings.decks).toEqual(decks);
	});

	it('21. 知らないキーは、設定にもデッキにも残す', () => {
		const settings = loadSettingsData(WITH_UNKNOWN).settings as unknown as Record<string, unknown>;
		expect(settings['foo']).toBe(1);
		expect(settings['decks']).toEqual(WITH_UNKNOWN.decks);
	});

	it('22. 戻り値の decks に追加しても既定値は空のまま', () => {
		loadSettingsData(null).settings.decks.push({ name: 'A', folder: 'a', examDate: null });
		expect(DEFAULT_SETTINGS.decks).toEqual([]);
	});

	it('23. 戻り値のデッキを書き換えても、入力は変わらない', () => {
		const input = { decks: JSON.parse(JSON.stringify(BROKEN_DECKS)) as unknown[] };
		const deck = loadSettingsData(input).settings.decks[0]!;
		deck.name = 'changed';
		expect(input.decks).toEqual(BROKEN_DECKS);
	});

	it('24. 読み込んだ設定をもう一度読んでも同じ値になる', () => {
		for (const saved of [P1_SAVED, BEFORE_P1_SAVED, INTEGER_BROKEN, { decks: BROKEN_DECKS }, WITH_UNKNOWN]) {
			const once = loadSettingsData(saved).settings;
			const twice = loadSettingsData(once);
			expect(twice.settings).toEqual(once);
			expect(twice.resetKeys).toEqual([]);
		}
	});

	it('25. 新しい版の設定は版を残し、読めるところは読む', () => {
		const { settings, newer, savedVersion } = loadSettingsData({
			version: 99,
			dailyLimit: 5,
			decks: 'v2-shape',
		});
		expect(newer).toBe(true);
		expect(savedVersion).toBe(99);
		expect(settings.version).toBe(99);
		expect(settings.dailyLimit).toBe(5);
		expect(settings.decks).toEqual([]);
	});

	it('壊れた保存値（配列、文字列、数値）は既定値で、invalid', () => {
		for (const saved of [[], 'text', 42]) {
			const loaded = loadSettingsData(saved);
			expect(loaded.invalid).toBe(true);
			expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
		}
	});

	it('26. どの入力でも例外を投げない', () => {
		const inputs: unknown[] = [
			null,
			undefined,
			{},
			P1_SAVED,
			{ version: 1, dailyLimit: 5 },
			{ version: 99, newKey: 'x' },
			{ version: '1' },
			{ version: -1 },
			{ version: 1.5 },
			[],
			'text',
			42,
			INTEGER_BROKEN,
			{ dailyLimit: -1 },
			{ autoAdvance: 'yes' },
			{ decks: 'broken' },
			{ decks: BROKEN_DECKS },
			{ decks: [{ name: 'A', folder: 1, examDate: '2026-02-30' }] },
			WITH_UNKNOWN,
		];
		for (const saved of inputs) {
			expect(() => loadSettingsData(saved)).not.toThrow();
		}
	});
});
