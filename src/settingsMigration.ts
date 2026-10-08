// 設定（data.json）の形の版と、古い版からの移行（#27）。
// Obsidian にも settings.ts にも依存しない純粋関数だけを置き、ユニットテストで固める。
//
// 設定の形を変えるとき（項目の意味や形を変える、名前を変える。項目を足すだけなら要らない）：
// 1. SETTINGS_VERSION を1つ上げる
// 2. MIGRATIONS に「前の版 → 新しい版」の関数を1つ足す（引数を書き換えず、知らないキーは残す）
// 3. tests/settingsMigration.test.ts に、前の版の保存値が新しい形になるケースを足す
// 型の確かめ（手で書き換えた値や壊れた値を既定値に戻す）は settings.ts の normalizeSettings の役目で、
// 移行の関数は形の変換だけを書く。

/** 設定の形の版。形を変える移行を足すたびに1つ上げる */
export const SETTINGS_VERSION = 1;

export type SettingsData = Record<string, unknown>;

export type Migrations = Readonly<Record<number, (data: SettingsData) => SettingsData>>;

/**
 * MIGRATIONS[n] は、版 n で保存された設定を版 n+1 の形にする。
 * 引数を書き換えず、新しいオブジェクトを返す純粋関数。知らないキーは残す。
 * 0 から SETTINGS_VERSION - 1 まで、すべての版に関数がある（テストで確かめる）
 */
export const MIGRATIONS: Migrations = {
	// 版 0（1.0.0 より前。版の番号がない）→ 版 1（1.0.0）。形は同じなので、版を付けるだけ
	0: (data) => ({ ...data }),
};

export interface MigrationResult {
	/** 移行した保存値（版 SETTINGS_VERSION の形）。整える前なので、型は確かめていない */
	data: SettingsData;
	/** 保存されていた版。保存がなければ null、版の番号がなければ 0 */
	savedVersion: number | null;
	/** このプラグインより新しい版で保存されていた。移行はしていない */
	newer: boolean;
	/** 保存値がオブジェクトでなかった（壊れている）。data は空 */
	invalid: boolean;
}

/** 保存値の版を読み、版 SETTINGS_VERSION まで順に移行する */
export function migrateSettingsData(saved: unknown): MigrationResult {
	return migrateWith(saved, MIGRATIONS, SETTINGS_VERSION);
}

/**
 * 移行の表と目標の版を引数で受け取る本体。migrateSettingsData はこれを呼ぶだけ。
 * 版が2つ以上ある場合の順の適用を、テスト用の表で確かめるために分ける
 */
export function migrateWith(
	saved: unknown,
	migrations: Migrations,
	targetVersion: number,
): MigrationResult {
	if (saved === null || saved === undefined) {
		return { data: {}, savedVersion: null, newer: false, invalid: false };
	}
	if (typeof saved !== 'object' || Array.isArray(saved)) {
		return { data: {}, savedVersion: 0, newer: false, invalid: true };
	}
	// 引数を書き換えないように複製する。保存値はもともと JSON なので、JSON の往復で失うものはない
	let data = JSON.parse(JSON.stringify(saved)) as SettingsData;
	const savedVersion = readVersion(data['version']);
	if (savedVersion > targetVersion) {
		return { data, savedVersion, newer: true, invalid: false };
	}
	for (let version = savedVersion; version < targetVersion; version++) {
		const migrate = migrations[version];
		if (!migrate) throw new Error(`設定の版 ${version} から移行する関数がありません`);
		data = migrate(data);
	}
	data['version'] = targetVersion;
	return { data, savedVersion, newer: false, invalid: false };
}

/** 0 以上の整数ならその版。それ以外（ない、文字列、負、小数）は版の番号がないとみなして 0 */
function readVersion(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
