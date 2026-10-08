import { App, Notice, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type StudyCurvePlugin from './main';
import { SETTINGS_VERSION, SettingsData, migrateSettingsData } from './settingsMigration';
import { findNoteTemplate } from './studyCurve/actions';
import { isCalendarDate, todayISO } from './studyCurve/dateUtils';
import { ConfirmModal } from './studyCurve/ConfirmModal';
import {
	buildDeckRemoveConfirm,
	planDeckRename,
	renameHint,
	renameSubmitLabel,
} from './studyCurve/deckChange';
import { deckListWarnings, normalizeFolderInput } from './studyCurve/deckInference';
import { DeckEditModal } from './studyCurve/DeckEditModal';
import { FileSuggest } from './studyCurve/FileSuggest';
import { DEFAULT_INTERVALS, formatIntervals, parseIntervals } from './studyCurve/schedule';
import { ParseResult, parseIntegerInput, parseIntervalsInput } from './studyCurve/settingsInput';
import { daysToExam } from './studyCurve/reviewQueue';
import type { QueueOptions } from './studyCurve/reviewQueue';
import { countNotesByDeck } from './studyCurve/studyIndex';
import { DeckConfig } from './studyCurve/types';

// 新しく足す・変えた UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	noteHeading: '復習ノート',
	clearChecksName: '採点したら本文のチェックを外す',
	clearChecksDesc:
		'☆◯△✗ で採点したとき、下の「チェックを外す見出し」を含む見出しの下にある完了のチェック（- [x]）を未完了（- [ ]）に戻す。「思い出せるか」の自己チェックを毎回やり直すため。ほかの見出しの下、frontmatter、コードブロックの中は変更しない。',
	checkSectionName: 'チェックを外す見出し',
	checkSectionDesc:
		'この文字列を含む見出しから、同じかそれより上のレベルの次の見出しの手前までが対象。大文字と小文字は区別しない。空にすると何も外さない。',
	noDecks:
		'まだデッキがありません。「デッキを追加」から作るか、復習ボードの案内から、登録済みのノートのデッキを取り込めます。',
	deckCreated: (name: string) => `デッキ「${name}」を作成しました`,
	templateName: '復習ノートのテンプレート',
	templateDesc:
		'「復習ノートを作成」で使うテンプレートのファイル。空欄なら内蔵の型を使います。{{title}}・{{deck}}・{{date}} が置き換わります。',
	templatePlaceholder: '例：Templates/復習ノート.md',
	templateMissing: 'ファイルが見つかりません。内蔵の型が使われます。',
	// 数値と間隔の欄（#26）
	intervalsDesc: (defaults: string) =>
		`カンマ区切り。左からステージ0,1,2…の間隔。◯でステージが1つ進み、△は据え置き、✗でステージ0に戻る。☆（初見）は据え置きで、この間隔ではなく3日固定。最終ステージ以降は末尾の間隔を繰り返す。空欄なら既定の間隔（${defaults}）を使う。`,
	invalidKeep: (error: string, saved: string) => `${error}（保存されている値：${saved}）`,
	blankValue: '空欄',
	// デッキの一覧（#26）
	unnamed: '（名前なし）',
	deckSummary: (folder: string, examDate: string, count: number) =>
		`フォルダ：${folder} ／ 試験日：${examDate} ／ ノート ${count} 件`,
	noFolder: 'なし',
	noExamDate: '未設定',
	daysLeft: (days: number) => `（あと ${days} 日）`,
	examToday: '（今日）',
	examOver: '（終了）',
	edit: '編集',
	deckMissing: 'デッキが見つかりませんでした。設定画面を開き直してください。',
};

/** 一覧の試験日。年が分かるように YYYY-MM-DD で出し、残りの日数を添える（formatShort は年がない） */
function examDateLabel(examDate: string | null, today: string): string {
	if (examDate === null) return TEXT.noExamDate;
	const days = daysToExam(examDate, today) ?? 0;
	const rest = days > 0 ? TEXT.daysLeft(days) : days === 0 ? TEXT.examToday : TEXT.examOver;
	return `${examDate}${rest}`;
}

export interface StudyCurveSettings {
	/** 設定の形の版（#27）。保存のたびに書く。画面では使わない */
	version: number;
	decks: DeckConfig[];
	intervalsRaw: string;
	finalSprintDays: number;
	dailyLimit: number;
	forecastDays: number;
	// 採点した直後にキューの次のノートを開くか
	autoAdvance: boolean;
	// 採点時に、checkSectionHeading を含む見出しの下のチェックを外すか。
	// ほかの人のノートのタスクを書き換えないように、既定は OFF（#20）
	clearChecksOnGrade: boolean;
	// チェックを外すセクションの見出しに含まれる文字列。空なら何も外さない
	checkSectionHeading: string;
	// 「復習ノートを作成」で使うテンプレートのファイルのパス。空なら内蔵の型（#10）
	noteTemplatePath: string;
}

// デッキの既定は空。最初のデッキは復習ボードの案内から作るか、登録済みのノートから取り込む。
// この定数は直接使わず、loadSettingsData で複製してから使う（デッキの追加が定数を書き換えないように）。
export const DEFAULT_SETTINGS: StudyCurveSettings = {
	version: SETTINGS_VERSION,
	decks: [],
	intervalsRaw: formatIntervals(DEFAULT_INTERVALS),
	finalSprintDays: 7,
	dailyLimit: 20,
	forecastDays: 14,
	autoAdvance: true,
	clearChecksOnGrade: false,
	checkSectionHeading: '思い出せるか',
	noteTemplatePath: '',
};

/** 整数の設定と、その下限。整える処理（#27）と設定画面の入力の検証（#26）で同じ値を使う */
export const INTEGER_SETTINGS = {
	dailyLimit: { min: 0 }, // 0 は無制限
	finalSprintDays: { min: 0 }, // 0 は直前総ざらいなし
	forecastDays: { min: 1 },
} as const satisfies Record<string, { min: number }>;

export interface LoadedSettings {
	settings: StudyCurveSettings;
	/** 保存されていた版。保存がなければ null、版の番号がなければ 0 */
	savedVersion: number | null;
	/** このプラグインより新しい版で保存されていた（保存を止める） */
	newer: boolean;
	/** 保存値が設定として読めなかった（既定値で動く） */
	invalid: boolean;
	/** 整える処理で既定値に戻した項目の名前（開発者コンソールに出す。通知はしない） */
	resetKeys: string[];
}

/** 複製は JSON の往復で行う（structuredClone は iOS の Safari 15.4 以降の機能のため）。設定はもともと JSON */
function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * 移行した保存値の型を確かめ、合わない項目だけ既定値にする（#27）。知らないキーは残す。
 * 書かれていない項目は既定値で補うだけで、既定値に戻した項目には数えない（項目を足す前の保存値）。
 * 戻り値は DEFAULT_SETTINGS とも引数とも、配列やオブジェクトを共有しない
 */
export function normalizeSettings(data: SettingsData): {
	settings: StudyCurveSettings;
	resetKeys: string[];
} {
	const defaults = cloneJson(DEFAULT_SETTINGS);
	const source = cloneJson(data);
	const resetKeys: string[] = [];
	const take = <T>(key: string, isValid: (value: unknown) => value is T, fallback: T): T => {
		const value = source[key];
		if (isValid(value)) return value;
		if (value !== undefined) resetKeys.push(key);
		return fallback;
	};
	const integer = (key: keyof typeof INTEGER_SETTINGS): number =>
		take(
			key,
			// 文字列の "5" も既定値にする（手で書いた値を推測で読まない）
			(value): value is number =>
				typeof value === 'number' &&
				Number.isInteger(value) &&
				value >= INTEGER_SETTINGS[key].min,
			defaults[key],
		);

	const decks = normalizeDecks(source['decks'], resetKeys);
	return {
		settings: {
			...source,
			version: SETTINGS_VERSION,
			decks,
			intervalsRaw: take('intervalsRaw', isString, defaults.intervalsRaw),
			finalSprintDays: integer('finalSprintDays'),
			dailyLimit: integer('dailyLimit'),
			forecastDays: integer('forecastDays'),
			autoAdvance: take('autoAdvance', isBoolean, defaults.autoAdvance),
			clearChecksOnGrade: take('clearChecksOnGrade', isBoolean, defaults.clearChecksOnGrade),
			checkSectionHeading: take('checkSectionHeading', isString, defaults.checkSectionHeading),
			noteTemplatePath: take('noteTemplatePath', isString, defaults.noteTemplatePath),
		},
		resetKeys,
	};
}

/**
 * デッキの一覧を整える。名前（文字列）のない要素は、どのノートともつながらないので捨てる。
 * 同じ名前や空の名前のデッキは消さない（どれを残すかは利用者が決める。#26 の設定画面で警告する）
 */
function normalizeDecks(value: unknown, resetKeys: string[]): DeckConfig[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		resetKeys.push('decks');
		return [];
	}
	const decks: DeckConfig[] = [];
	value.forEach((raw: unknown, index) => {
		const at = `decks[${index}]`;
		if (!isRecord(raw) || typeof raw['name'] !== 'string') {
			resetKeys.push(at);
			return;
		}
		const folder = raw['folder'];
		if (folder !== undefined && typeof folder !== 'string') resetKeys.push(`${at}.folder`);
		const examDate = raw['examDate'];
		// 存在しない日付（2026-02-30）は計算がずれるので未設定にする
		const validExamDate = isCalendarDate(examDate);
		if (!validExamDate && examDate !== null && examDate !== undefined) {
			resetKeys.push(`${at}.examDate`);
		}
		decks.push({
			...raw,
			name: raw['name'].trim(),
			folder: typeof folder === 'string' ? folder.trim() : '',
			examDate: validExamDate ? examDate : null,
		});
	});
	return decks;
}

/** 保存値から設定を作る（移行 → 整える）。main.ts の loadSettings はこれだけを呼ぶ。例外は投げない */
export function loadSettingsData(saved: unknown): LoadedSettings {
	try {
		const migrated = migrateSettingsData(saved);
		const { settings, resetKeys } = normalizeSettings(migrated.data);
		// 新しい版の設定は保存しないが、どの版を読んだかは残す
		if (migrated.newer && migrated.savedVersion !== null) settings.version = migrated.savedVersion;
		return {
			settings,
			savedVersion: migrated.savedVersion,
			newer: migrated.newer,
			invalid: migrated.invalid,
			resetKeys,
		};
	} catch (error) {
		// 移行の関数の誤りなど（テストで全版を通すので、起きれば実装の誤り）。プラグインは既定値で動かす
		console.error('Study Curve: 設定の移行に失敗しました', error);
		return {
			settings: normalizeSettings({}).settings,
			savedVersion: null,
			newer: false,
			invalid: true,
			resetKeys: [],
		};
	}
}

/** #9 の入り口。呼び出しとテストを保つために残す（移行と整える処理を通した設定を返す） */
export function mergeSettings(saved: unknown): StudyCurveSettings {
	return loadSettingsData(saved).settings;
}

export function queueOptions(settings: StudyCurveSettings): QueueOptions {
	return {
		decks: settings.decks,
		intervals: parseIntervals(settings.intervalsRaw),
		finalSprintDays: settings.finalSprintDays,
		dailyLimit: settings.dailyLimit,
	};
}

export class StudyCurveSettingTab extends PluginSettingTab {
	/**
	 * 設定画面が開いているか。display で true、hide で false（#27）。
	 * 非公開の API（app.setting.activeTab）を使わずに、開いているときだけ描き直すため
	 */
	private shown = false;

	constructor(app: App, private plugin: StudyCurvePlugin) {
		super(app, plugin);
	}

	/** 開いていれば、今の設定で描き直す（同期で設定を読み直したとき。入力中の欄のカーソルは外れる） */
	refreshIfShown(): void {
		if (this.shown) this.display();
	}

	hide(): void {
		this.shown = false;
		super.hide();
	}

	/**
	 * 設定済みのデッキを編集のダイアログで直す（#26）。target は参照で探す（同じ名前のデッキがあっても取り違えない）
	 */
	private openEdit(target: DeckConfig): void {
		// 説明は開いた時点の件数で出す。確定したときは updateDeck が数え直す（実際に書き換えるのは確定した時点のノート）
		const counts = countNotesByDeck(this.plugin.getIndex().notes);
		const others = this.plugin.settings.decks
			.filter((deck) => deck !== target)
			.map((deck) => deck.name);
		new DeckEditModal(this.app, {
			mode: 'edit',
			initial: { ...target },
			describeName: (name) => {
				const plan = planDeckRename({
					from: target.name,
					to: name.trim(),
					otherDeckNames: others,
					noteCounts: counts,
				});
				return { hint: renameHint(plan), submitLabel: renameSubmitLabel(plan) };
			},
			existingNames: () => {
				const decks = this.plugin.settings.decks;
				// target が設定にない（同期で読み直された、ほかで削除された）なら名前は確かめず、updateDeck の
				// missing に任せる。読み直した設定には target と同じ名前の別のオブジェクトがあり、自分を除けないため
				return decks.includes(target)
					? decks.filter((deck) => deck !== target).map((deck) => deck.name)
					: [];
			},
			onSubmit: async (next) => {
				// 保存の例外はダイアログが理由を出す（設定は元に戻っているので、そのまま押し直せる）
				const result = await this.plugin.actions.updateDeck(target, next);
				// ほかのまとめての処理の最中、設定を保存できない（#22・#27）：何も変えていないので、閉じずに押し直せる。
				// 通知は updateDeck が出す
				if (result === 'busy' || result === 'blocked') return false;
				if (result === 'missing') new Notice(TEXT.deckMissing);
				this.refreshIfShown();
				return true;
			},
		}).open();
	}

	/**
	 * デッキの削除の前に確認する（#25）。ノートがあれば「ノートを残して削除」と「N 件を復習対象から外して削除」から
	 * 選ぶ。target は参照で探す（描いた後に一覧が変わっても、別のデッキを消さない）。
	 * removeDeck は設定の保存までを待ち、ノートを外す処理は待たないので、ダイアログは保存が終わればすぐ閉じる。
	 * busy・blocked のときも閉じる（通知は removeDeck が出す。設定は変わっていないので、もう一度押せばよい）
	 */
	private confirmRemove(target: DeckConfig): void {
		const sharedName = this.plugin.settings.decks.some(
			(deck) => deck !== target && deck.name === target.name,
		);
		const notePaths = this.plugin
			.getIndex()
			.notes.filter((note) => note.deck === target.name)
			.map((note) => note.filePath);
		const { options, unenrollLabel } = buildDeckRemoveConfirm({
			deckName: target.name,
			deckFolder: target.folder,
			notePaths,
			sharedName,
		});
		const run = async (notes: 'keep' | 'unenroll') => {
			const result = await this.plugin.actions.removeDeck(target, notes);
			if (result === 'missing') new Notice(TEXT.deckMissing);
			this.refreshIfShown();
		};
		new ConfirmModal(
			this.app,
			{
				...options,
				// 履歴が消えて戻せないので赤
				...(unenrollLabel !== null && {
					alternative: { label: unenrollLabel, warning: true, run: () => run('unenroll') },
				}),
			},
			() => run('keep'),
		).open();
	}

	/** 整数の欄（#26）。下限は INTEGER_SETTINGS（#27 の読み込みの整える処理と同じ値） */
	private addIntegerSetting(
		containerEl: HTMLElement,
		key: keyof typeof INTEGER_SETTINGS,
		name: string,
		desc: string,
	): void {
		this.addValidatedText(new Setting(containerEl).setName(name).setDesc(desc), {
			value: String(this.plugin.settings[key]),
			// スマホで数字のキーボードを出す。type="number" は 2.5 や 1e3 を受け付け、空と不正を区別できない
			inputMode: 'numeric',
			parse: (raw) => parseIntegerInput(raw, INTEGER_SETTINGS[key].min),
			saved: () => String(this.plugin.settings[key]),
			apply: (value) => {
				this.plugin.settings[key] = value;
			},
		});
	}

	/**
	 * 入力を検証してから保存する欄（#26）。正しくない値は保存せず（今の値のまま）、
	 * 欄の説明の下に理由と保存されている値を出す。黙って別の値に変えない
	 */
	private addValidatedText<T>(
		setting: Setting,
		options: {
			value: string;
			placeholder?: string;
			inputMode?: string;
			parse: (raw: string) => ParseResult<T>;
			/** 保存されている値（エラーの文言に出す） */
			saved: () => string;
			apply: (value: T) => void;
		},
	): void {
		const errorEl = setting.descEl.createDiv({
			cls: 'study-curve-setting-error',
			attr: { 'aria-live': 'polite' },
		});
		setting.addText((text) => {
			if (options.inputMode) text.inputEl.inputMode = options.inputMode;
			if (options.placeholder) text.setPlaceholder(options.placeholder);
			text.setValue(options.value).onChange(async (raw) => {
				const parsed = options.parse(raw);
				if (!parsed.ok) {
					errorEl.setText(TEXT.invalidKeep(parsed.error, options.saved()));
					text.inputEl.setAttr('aria-invalid', 'true');
					return;
				}
				errorEl.setText('');
				text.inputEl.removeAttribute('aria-invalid');
				options.apply(parsed.value);
				await this.plugin.saveSettings();
			});
		});
	}

	display(): void {
		this.shown = true;
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('復習間隔').setHeading();

		const defaultIntervals = formatIntervals(DEFAULT_INTERVALS);
		// 入力欄の文字は書き換えない（入力中にカーソルが飛ばないように）。そろえた形は次に開いたときに出る
		this.addValidatedText(
			new Setting(containerEl)
				.setName('ステージごとの間隔（日）')
				.setDesc(TEXT.intervalsDesc(defaultIntervals)),
			{
				value: this.plugin.settings.intervalsRaw,
				placeholder: defaultIntervals,
				parse: parseIntervalsInput,
				saved: () => this.plugin.settings.intervalsRaw || TEXT.blankValue,
				apply: (value) => {
					this.plugin.settings.intervalsRaw = value;
				},
			},
		);

		this.addIntegerSetting(
			containerEl,
			'dailyLimit',
			'1日に出す上限',
			'復習キューに並べる最大件数。0で無制限。',
		);
		this.addIntegerSetting(
			containerEl,
			'finalSprintDays',
			'直前総ざらいの日数',
			'試験日までこの日数を切ったデッキは、予定日に関係なく全ノートを復習キューに出す。',
		);
		this.addIntegerSetting(
			containerEl,
			'forecastDays',
			'予定グラフの日数',
			'復習ボードと study-forecast ブロックで先を見る日数。',
		);

		new Setting(containerEl)
			.setName('採点したら次のノートを開く')
			.setDesc('復習ボードで☆◯△✗を押した直後に、キューの次のノートを開く。')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAdvance)
					.onChange(async (value) => {
						this.plugin.settings.autoAdvance = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName(TEXT.noteHeading).setHeading();

		new Setting(containerEl)
			.setName(TEXT.clearChecksName)
			.setDesc(TEXT.clearChecksDesc)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.clearChecksOnGrade)
					.onChange(async (value) => {
						this.plugin.settings.clearChecksOnGrade = value;
						await this.plugin.saveSettings();
					}),
			);

		// トグルが OFF でも表示する（出し分けのために設定画面を描き直さない）
		new Setting(containerEl)
			.setName(TEXT.checkSectionName)
			.setDesc(TEXT.checkSectionDesc)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.checkSectionHeading)
					.setValue(this.plugin.settings.checkSectionHeading)
					.onChange(async (value) => {
						this.plugin.settings.checkSectionHeading = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		const templateSetting = new Setting(containerEl)
			.setName(TEXT.templateName)
			.setDesc(TEXT.templateDesc);
		const templateWarning = templateSetting.descEl.createDiv({ cls: 'study-curve-form-error' });
		// 1文字ごとに確かめると入力の途中で警告が出るので、開いたときと入力欄から離れたとき、候補を選んだときに確かめる
		const checkTemplate = (value: string) => {
			const missing = value.trim() !== '' && findNoteTemplate(this.app, value) === null;
			templateWarning.setText(missing ? TEXT.templateMissing : '');
		};
		templateSetting.addText((text) => {
			text
				.setPlaceholder(TEXT.templatePlaceholder)
				.setValue(this.plugin.settings.noteTemplatePath)
				.onChange(async (value) => {
					this.plugin.settings.noteTemplatePath = value.trim();
					await this.plugin.saveSettings();
				});
			text.inputEl.addEventListener('blur', () => checkTemplate(text.getValue()));
			new FileSuggest(this.app, text.inputEl, () => checkTemplate(text.getValue()));
		});
		checkTemplate(this.plugin.settings.noteTemplatePath);

		new Setting(containerEl).setName('デッキ（資格・科目）').setHeading();
		containerEl.createEl('p', {
			cls: 'setting-item-description',
			text: 'フォルダは未登録ノートの洗い出しと、ノート登録時のデッキ自動判定に使う。試験日を入れると、それを越える復習予定は試験日当日まで前倒しされる。',
		});

		if (this.plugin.settings.decks.length === 0) {
			containerEl.createEl('p', { cls: 'setting-item-description', text: TEXT.noDecks });
		}

		// 行は表示だけにし、直すのは編集のダイアログで行う（入力の途中の値を保存しない。#26）。
		// ノートの件数は描いた時点のもの（インデックスの変化で描き直すと、入力中の欄のカーソルが飛ぶため）
		const decks = this.plugin.settings.decks;
		const counts = countNotesByDeck(this.plugin.getIndex().notes);
		// ダイアログのフォルダの警告（DeckEditModal）と同じく、保存するときと同じ整え方をしてから確かめる
		const warnings = deckListWarnings(
			decks,
			(folder) =>
				this.app.vault.getAbstractFileByPath(normalizeFolderInput(folder)) instanceof TFolder,
		);
		const today = todayISO();
		decks.forEach((deck, index) => {
			const setting = new Setting(containerEl)
				.setName(deck.name.trim() === '' ? TEXT.unnamed : deck.name)
				.setDesc(
					createFragment((fragment) => {
						fragment.createDiv({
							cls: 'study-curve-deck-summary',
							text: TEXT.deckSummary(
								deck.folder === '' ? TEXT.noFolder : deck.folder,
								examDateLabel(deck.examDate, today),
								counts.get(deck.name) ?? 0,
							),
						});
						for (const warning of warnings[index] ?? []) {
							fragment.createDiv({ cls: 'study-curve-deck-row-warning', text: warning.message });
						}
					}),
				)
				.addExtraButton((button) =>
					button
						.setIcon('pencil')
						.setTooltip(TEXT.edit)
						.onClick(() => this.openEdit(deck)),
				)
				.addExtraButton((button) =>
					button
						.setIcon('trash')
						.setTooltip('このデッキを削除')
						.onClick(() => this.confirmRemove(deck)),
				);
			setting.settingEl.addClass('study-curve-deck-row');
		});

		new Setting(containerEl).addButton((button) =>
			button
				.setButtonText('デッキを追加')
				.setCta()
				.onClick(() => {
					// 仮の名前のデッキは作らず、ボードの案内と同じダイアログで名前などを入れてもらう
					new DeckEditModal(this.app, {
						mode: 'create',
						existingNames: () => this.plugin.settings.decks.map((deck) => deck.name),
						onSubmit: async (deck) => {
							const added = await this.plugin.actions.addDecks([deck]);
							if (added === null) return false; // 保存に失敗（通知は actions が出す）
							if (added > 0) new Notice(TEXT.deckCreated(deck.name));
							this.display();
							return true;
						},
					}).open();
				}),
		);
	}
}
