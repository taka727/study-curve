import { describe, expect, it } from 'vitest';
import {
	MIGRATIONS,
	SETTINGS_VERSION,
	SettingsData,
	migrateSettingsData,
	migrateWith,
} from '../src/settingsMigration';

// 設計書 §6.1 の表（#27）

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

describe('migrateSettingsData', () => {
	it('1. 0 から SETTINGS_VERSION - 1 まで、すべての版に移行の関数がある', () => {
		for (let version = 0; version < SETTINGS_VERSION; version++) {
			expect(typeof MIGRATIONS[version]).toBe('function');
		}
	});

	it('2. 保存がなければ（null、undefined）版は null で、data は空', () => {
		for (const saved of [null, undefined]) {
			expect(migrateSettingsData(saved)).toEqual({
				data: {},
				savedVersion: null,
				newer: false,
				invalid: false,
			});
		}
	});

	it('3. {} は版 0 として移行し、版 1 になる', () => {
		const result = migrateSettingsData({});
		expect(result.savedVersion).toBe(0);
		expect(result.data['version']).toBe(1);
		expect(result.newer).toBe(false);
		expect(result.invalid).toBe(false);
	});

	it('4. P1 の時点の形（版なし）は、version 以外の値が入力と同じ', () => {
		const result = migrateSettingsData(P1_SAVED);
		expect(result.savedVersion).toBe(0);
		expect(result.data).toEqual({ ...P1_SAVED, version: 1 });
	});

	it('5. 版 1 の保存値はそのまま', () => {
		const result = migrateSettingsData({ version: 1, dailyLimit: 5 });
		expect(result.savedVersion).toBe(1);
		expect(result.data).toEqual({ version: 1, dailyLimit: 5 });
	});

	it('6. 新しい版の保存値は移行せず、版と知らないキーを残す', () => {
		const result = migrateSettingsData({ version: 99, newKey: 'x' });
		expect(result.newer).toBe(true);
		expect(result.savedVersion).toBe(99);
		expect(result.data).toEqual({ version: 99, newKey: 'x' });
	});

	it('7. 版が文字列、負、小数なら版 0 とみなす', () => {
		for (const version of ['1', -1, 1.5]) {
			const result = migrateSettingsData({ version });
			expect(result.savedVersion).toBe(0);
			expect(result.data['version']).toBe(1);
		}
	});

	it('8. 配列、文字列、数値は壊れた保存値として data を空にする', () => {
		for (const saved of [[], 'text', 42]) {
			expect(migrateSettingsData(saved)).toEqual({
				data: {},
				savedVersion: 0,
				newer: false,
				invalid: true,
			});
		}
	});

	it('9. 入力のオブジェクトを書き換えない', () => {
		const saved = { dailyLimit: 5, decks: [{ name: 'A', folder: '', examDate: null }] };
		const before = JSON.parse(JSON.stringify(saved)) as unknown;
		const result = migrateSettingsData(saved);
		expect(saved).toEqual(before);
		expect('version' in saved).toBe(false);
		expect(result.data['decks']).not.toBe(saved.decks);
	});

	it('10. 移行の関数を版の順に適用する（版 0 → 1 → 2）', () => {
		const table = {
			0: (data: SettingsData) => ({ ...data, first: true }),
			1: (data: SettingsData) => ({ ...data, second: data['first'] === true ? 'after-first' : 'only' }),
		};
		expect(migrateWith({ a: 1 }, table, 2).data).toEqual({
			a: 1,
			first: true,
			second: 'after-first',
			version: 2,
		});
		// 版 1 の保存値なら2段目だけ
		expect(migrateWith({ version: 1, a: 1 }, table, 2).data).toEqual({
			a: 1,
			second: 'only',
			version: 2,
		});
	});

	it('移行の関数が欠けていたら例外（実装の誤り。テスト1で防ぐ）', () => {
		expect(() => migrateWith({}, {}, 1)).toThrow();
	});
});
