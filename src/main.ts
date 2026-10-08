import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import {
	StudyCurveSettingTab,
	StudyCurveSettings,
	loadSettingsData,
	queueOptions,
} from './settings';
import { SettingsLoadSequencer } from './settingsLoadSequencer';
import { StudyActions, errorMessage } from './studyCurve/actions';
import { ConfirmModal } from './studyCurve/ConfirmModal';
import { inferDecksFromNotes } from './studyCurve/deckInference';
import { DeckSuggestModal } from './studyCurve/DeckSuggestModal';
import { DEFAULT_NOTE_TITLE, joinPath, sanitizeFileName } from './studyCurve/noteFile';
import {
	StudyBoardView,
	VIEW_TYPE_STUDY_BOARD,
} from './studyCurve/StudyBoardView';
import { registerStudyForecastBlock } from './studyCurve/StudyForecastBlock';
import { registerStudyProgressBlock } from './studyCurve/StudyProgressBlock';
import { registerStudyTodayBlock } from './studyCurve/StudyTodayBlock';
import { todayISO } from './studyCurve/dateUtils';
import { DAY_CHECK_INTERVAL_MS, DayWatcher } from './studyCurve/dayWatcher';
import { buildQueue } from './studyCurve/reviewQueue';
import { TextInputModal } from './studyCurve/TextInputModal';
import { buildUnenrollConfirm } from './studyCurve/unenrollConfirm';
import { parseIntervals } from './studyCurve/schedule';
import { StudyIndex, buildStudyIndex } from './studyCurve/studyCache';
import {
	allDeckNames,
	findDeck,
	readStudyNote,
	resolveDeckForPath,
} from './studyCurve/studyIndex';
import { enrollNote, setSuspended } from './studyCurve/studyMutator';
import { DeckConfig, Grade, GRADE_LABELS, QueueItem, StudyNote } from './studyCurve/types';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	deckAdded: (name: string) => `デッキ「${name}」を設定に追加しました`,
	createNote: '復習ノートを作成',
	createNotePlaceholder: '例：IAM のポリシー評価',
	createNoteSubmit: '作成',
	fileNamePreview: (path: string) => `ファイル名：${path}`,
	defaultFolder: '（新規ノートの作成場所）',
	titleRequired: 'タイトルを入力してください',
	createNoteFailed: (reason: string) => `復習ノートの作成に失敗しました：${reason}`,
	openNoteFailed: (name: string, reason: string) => `「${name}」を開けませんでした：${reason}`,
	// 設定の読み込みと保存（#27）。起動時にどのプラグインの通知かが分かるように、名前から始める
	newerVersion:
		'Study Curve：設定がこの版より新しい形で保存されています。プラグインを更新してください。それまでは設定を変えても保存しません。',
	saveBlocked:
		'Study Curve：プラグインが古いため、設定を保存しませんでした。プラグインを更新してください。',
	saveDuringReload:
		'Study Curve：設定を読み直していたため、今の変更は保存しませんでした。もう一度変えてください。',
	unreadable:
		'Study Curve：設定ファイル（data.json）を読み込めなかったため、既定の設定で動いています。設定を変えると、ファイルは書き直されます。',
};

/** 設定の版や読み込みの問題を知らせる通知の表示時間 */
const NOTICE_LONG_MS = 10_000;

export default class StudyCurvePlugin extends Plugin {
	settings!: StudyCurveSettings;
	actions!: StudyActions;
	/** 同期で設定を読み直したときに、開いている設定画面を描き直すために持つ（#27）。onload で作る */
	private settingTab: StudyCurveSettingTab | null = null;

	// Vault 全体の走査結果はプラグインで1つだけ持ち、ボードと各ブロックで使い回す。
	// 端末が非力でも、開いているブロックの数だけ走査が走ることがないようにするため。
	private index: StudyIndex | null = null;
	private indexListeners = new Set<() => void>();
	private notifyTimer: number | null = null;

	/** このプラグインより新しい版の設定を読んだので、保存を止めている（#27） */
	private settingsSaveBlocked = false;
	/** 保存を止めたことを通知したか（保存を止めている間に1回だけ通知する） */
	private saveBlockedNotified = false;
	/**
	 * 設定の読み込みの順番。同期で読み直しが続けて呼ばれても、最後に始めた読み込みの結果だけを使い、
	 * それが終わるまでは読み込みの最中として保存しない
	 */
	private readonly settingsLoad = new SettingsLoadSequencer();

	async onload() {
		await this.loadSettings();
		this.actions = new StudyActions(this);

		// メタデータやファイルが動いたらインデックスを捨てる。
		// 作り直しは次に必要になったときまで遅延させる。
		// 採点などで書き込んだ直後のノートは、作り直しのときに actions.stateFor が
		// キャッシュの中身と書き込んだ状態を比べて、反映されたかを判断する。
		this.registerEvent(
			this.app.metadataCache.on('changed', () => this.invalidateIndex()),
		);
		this.registerEvent(
			this.app.metadataCache.on('deleted', () => this.invalidateIndex()),
		);
		this.registerEvent(this.app.vault.on('create', () => this.invalidateIndex()));
		this.registerEvent(this.app.vault.on('delete', () => this.invalidateIndex()));
		this.registerEvent(this.app.vault.on('rename', () => this.invalidateIndex()));

		this.registerView(
			VIEW_TYPE_STUDY_BOARD,
			(leaf) => new StudyBoardView(leaf, this),
		);

		this.addRibbonIcon('brain', '復習ボードを開く', () => {
			void this.activateBoard();
		});

		this.addCommand({
			id: 'open-study-board',
			name: '復習ボードを開く',
			callback: () => {
				void this.activateBoard();
			},
		});

		this.addCommand({
			id: 'start-review',
			name: '今日の復習を始める（最初のノートを開く）',
			callback: () => {
				const queue = this.getDueQueue();
				if (queue.length === 0) {
					new Notice('今日の復習はありません。');
					return;
				}
				void this.app.workspace.openLinkText(queue[0]!.note.filePath, '', false);
			},
		});

		this.addCommand({
			id: 'enroll-current-note',
			name: 'このノートを復習対象に登録',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (readStudyNote(this.app, file) !== null) return false;
				if (!checking) void this.enrollWithDeckPrompt(file);
				return true;
			},
		});

		this.addCommand({
			id: 'create-review-note',
			name: TEXT.createNote,
			callback: () => this.chooseDeckForNewNote(),
		});

		this.addCommand({
			id: 'unenroll-current-note',
			name: 'このノートを復習対象から外す',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || readStudyNote(this.app, file) === null) return false;
				if (!checking) this.confirmUnenrollFile(file.path);
				return true;
			},
		});

		const grades: Grade[] = ['good', 'hard', 'again', 'fresh'];
		for (const grade of grades) {
			this.addCommand({
				id: `grade-${grade}`,
				name: `復習を記録: ${GRADE_LABELS[grade]}`,
				checkCallback: (checking) => {
					const file = this.app.workspace.getActiveFile();
					if (!file || readStudyNote(this.app, file) === null) return false;
					if (!checking) void this.actions.grade(file.path, grade);
					return true;
				},
			});
		}

		this.addCommand({
			id: 'toggle-suspend-current-note',
			name: 'このノートの復習を休止／再開',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				const note = file ? readStudyNote(this.app, file) : null;
				if (!file || !note) return false;
				if (!checking) {
					void setSuspended(this.app, file.path, !note.suspended).then(() => {
						new Notice(
							note.suspended
								? `${file.basename} の復習を再開しました`
								: `${file.basename} の復習を休止しました`,
						);
					});
				}
				return true;
			},
		});

		const settingTab = new StudyCurveSettingTab(this.app, this);
		this.settingTab = settingTab;
		this.addSettingTab(settingTab);

		registerStudyTodayBlock(this);
		registerStudyForecastBlock(this);
		registerStudyProgressBlock(this);

		// 開いたままで日付が変わったら、「今日」を新しい日付で描き直す（#23）。
		// 1分おきに確かめるほか、アプリが前面に戻ったとき（iPad のアプリの切り替え、
		// デスクトップのウィンドウの切り替え）にもすぐ確かめる。裏ではタイマーが止まることがあるため
		const dayWatcher = new DayWatcher(todayISO, () => this.refreshViews());
		this.registerInterval(window.setInterval(() => dayWatcher.check(), DAY_CHECK_INTERVAL_MS));
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.visibilityState === 'visible') dayWatcher.check();
		});
		this.registerDomEvent(window, 'focus', () => dayWatcher.check());
	}

	onunload() {
		if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
		this.actions.dispose();
		this.indexListeners.clear();
	}

	getIndex(): StudyIndex {
		if (this.index === null) {
			this.index = buildStudyIndex(this.app, (path, fromCache) =>
				this.actions.stateFor(path, fromCache),
			);
		}
		return this.index;
	}

	// ビューとブロックはこれで更新通知を受け取る。個々に vault / metadataCache を
	// 購読してそれぞれデバウンスすると、同じ編集で何度も描き直すことになるため、
	// 通知の間引きはここに一本化する。
	onIndexChange(callback: () => void): () => void {
		this.indexListeners.add(callback);
		return () => this.indexListeners.delete(callback);
	}

	/**
	 * インデックスを捨てて、ビューとブロックに描き直しを頼む（300ms で間引く）。
	 * 採点などの書き込みのあとに actions も呼ぶ。
	 */
	invalidateIndex(): void {
		this.index = null;
		this.refreshViews();
	}

	/**
	 * インデックスはそのままで、ビューとブロックに描き直しを頼む（300ms で間引く）。
	 * 日付が変わったときに使う（ノートの中身は変わっていないので、Vault 全体を走査し直さない）
	 */
	private refreshViews(): void {
		if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
		this.notifyTimer = window.setTimeout(() => {
			this.notifyTimer = null;
			// 描き直しを待っていたノートの処理中を解いてから描く。描き直した行が押せる状態になる
			this.actions.viewsRefreshing();
			for (const listener of this.indexListeners) listener();
		}, 300);
	}

	// 週次レビューのTemplaterブロックから
	// app.plugins.plugins['study-curve'].getDueQueue() として呼ぶ。
	// 期日判定と直前総ざらいの条件をプラグイン側に集約し、テンプレートに
	// 同じロジックを複製しないため。
	getDueQueue(deckName?: string): QueueItem[] {
		const notes = this.getIndex().notes.filter(
			(note) => !deckName || note.deck === deckName,
		);
		return buildQueue(notes, queueOptions(this.settings), todayISO());
	}

	/**
	 * 復習対象から外す前に確認ダイアログを開き、確定したら外す（#24）。
	 * ボード、study-today ブロック、コマンドから呼ぶ。通知は actions.unenroll が出す
	 */
	confirmUnenroll(note: StudyNote): void {
		new ConfirmModal(this.app, buildUnenrollConfirm(note), async () => {
			// 画面はインデックスの更新で描き直される。通知（外した・処理中・失敗）は actions.unenroll が出す
			await this.actions.unenroll(note.filePath);
		}).open();
	}

	/** コマンドから。処理中のノートや、インデックスではもう外れているノートには何もしない */
	private confirmUnenrollFile(filePath: string): void {
		// 採点などの処理中は開かない（本文のステージと履歴が古くなる）。採点のコマンドと同じく通知も出さない
		if (this.actions.isBusy(filePath)) return;
		// metadataCache より新しい、書き込んだ直後の状態を使う（ボードと同じ値になる）
		const note = this.getIndex().notes.find((candidate) => candidate.filePath === filePath);
		if (!note) return;
		this.confirmUnenroll(note);
	}

	private async enrollWithDeckPrompt(file: TFile): Promise<void> {
		const matched = resolveDeckForPath(file.path, this.settings.decks);
		if (matched) {
			await this.enroll(file, matched.name, matched.examDate);
			return;
		}
		const names = allDeckNames(this.getIndex().notes, this.settings.decks);
		const configuredNames = this.settings.decks.map((deck) => deck.name);
		new DeckSuggestModal(this.app, names, configuredNames, (deckName) => {
			// 設定にない名前なら設定にも入れてから登録する（ノートにだけ書かれて迷子にならないように）。
			// 設定に入れられなかったら登録しない
			void this.resolveDeck(deckName).then(async (deck) => {
				if (deck) await this.enroll(file, deck.name, deck.examDate);
			});
		}).open();
	}

	/** コマンド「復習ノートを作成」。デッキを選んでから（設定になければ追加して）タイトルを入れてもらう */
	private chooseDeckForNewNote(): void {
		const names = allDeckNames(this.getIndex().notes, this.settings.decks);
		const configuredNames = this.settings.decks.map((deck) => deck.name);
		new DeckSuggestModal(this.app, names, configuredNames, (deckName) => {
			void this.resolveDeck(deckName).then((deck) => {
				if (deck) this.openCreateNoteDialog(deck);
			});
		}).open();
	}

	/**
	 * タイトルを入れてもらい、そのデッキに復習ノートを作って新しいタブで開く（#10）。
	 * コマンドと、ボードのデッキのカードの「＋ ノート」から呼ぶ
	 */
	openCreateNoteDialog(deck: DeckConfig): void {
		const folderLabel = deck.folder.trim() === '' ? TEXT.defaultFolder : normalizePath(deck.folder);
		new TextInputModal(
			this.app,
			{
				title: TEXT.createNote,
				placeholder: TEXT.createNotePlaceholder,
				submitLabel: TEXT.createNoteSubmit,
				// 重複の番号は作る時点で決まるので、ここでは出さない
				describe: (value) =>
					TEXT.fileNamePreview(
						joinPath(folderLabel, `${sanitizeFileName(value) || DEFAULT_NOTE_TITLE}.md`),
					),
				validate: (value) => (value.trim() === '' ? TEXT.titleRequired : null),
			},
			async (title) => {
				let file: TFile;
				try {
					file = await this.actions.createReviewNote(deck, title);
				} catch (error) {
					// ダイアログは閉じず、入力したタイトルを残す
					new Notice(TEXT.createNoteFailed(errorMessage(error)));
					return false;
				}
				// ボードから作ってもボードが消えないように、新しいタブで開く。ノートはもうあるので、
				// 開くのに失敗してもダイアログは閉じる（押し直して同じノートを2つ作らないように）
				void this.app.workspace
					.getLeaf('tab')
					.openFile(file, { active: true })
					.catch((error: unknown) => {
						new Notice(TEXT.openNoteFailed(file.basename, errorMessage(error)));
					});
				return true;
			},
		).open();
	}

	/**
	 * 名前に対応するデッキの設定を返す。設定になければ追加してから返す。
	 * フォルダは、その名前のノートがあれば推定し、なければ ''。
	 * 設定の保存に失敗したら null（通知は actions が出す）。呼び出し側はノートに名前を書かない
	 * （設定にないデッキ名がノートにだけ書かれて迷子になるのを防ぐのが、この関数の目的なので）。
	 * #10 の「復習ノートを作成」でも使う。
	 */
	private async resolveDeck(name: string): Promise<DeckConfig | null> {
		const existing = findDeck(name, this.settings.decks);
		if (existing) return existing;
		const folder =
			inferDecksFromNotes(this.getIndex().notes, this.settings.decks).find(
				(deck) => deck.name === name,
			)?.folder ?? '';
		const added = await this.actions.addDecks([{ name, folder, examDate: null }]);
		if (added === null) return null;
		if (added > 0) new Notice(TEXT.deckAdded(name));
		// 0 件なら、待っている間にほかの操作で同じ名前が追加された。どちらでも設定にあるものを返す
		return findDeck(name, this.settings.decks);
	}

	private async enroll(
		file: TFile,
		deckName: string,
		examDate: string | null,
	): Promise<void> {
		try {
			await enrollNote(
				this.app,
				file.path,
				deckName,
				parseIntervals(this.settings.intervalsRaw),
				examDate,
			);
			new Notice(`${file.basename} を ${deckName} に登録しました`);
		} catch (error) {
			new Notice(`登録に失敗しました: ${String(error)}`);
		}
	}

	async activateBoard(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_STUDY_BOARD)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_STUDY_BOARD, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * 設定を保存できない状態か。新しい版の設定を読んで保存を止めているか、設定を読み直している最中なら true。
	 * 設定とノートを一緒に変える操作（#22 の名前の変更、#25 の削除）が、始める前に見る
	 */
	isSettingsSaveBlocked(): boolean {
		return this.settingsSaveBlocked || this.settingsLoad.isLoading();
	}

	/**
	 * data.json を読み、版を移行して値を整える（#27）。読み込んだだけでは書かない
	 * （新しく入れた人に設定ファイルを作らない。同期に差分を出さない）。
	 * JSON として読めなくても、プラグインは既定値で動かす。
	 * 読み込みが重なったら最後に始めた読み込みの結果を使い、どの呼び出しもそれが終わってから返る
	 * （起動時の読み込みが同期の読み直しに追い越されても、this.settings が入る前に onload が進まない）
	 */
	async loadSettings(): Promise<void> {
		await this.settingsLoad.run(
			async (): Promise<{ saved: unknown; readError: unknown }> => {
				try {
					return { saved: await this.loadData(), readError: null };
				} catch (error) {
					// JSON として読めない
					return { saved: null, readError: error };
				}
			},
			({ saved, readError }) => this.applyLoadedSettings(saved, readError),
		);
	}

	private applyLoadedSettings(saved: unknown, readError: unknown): void {
		const loaded = loadSettingsData(saved);
		this.settings = loaded.settings;
		this.settingsSaveBlocked = loaded.newer;
		// 保存を止めるたびに1回知らせる（同期で古い版に戻った後、また新しい版になったときも知らせる）
		if (!loaded.newer) this.saveBlockedNotified = false;
		if (loaded.newer) new Notice(TEXT.newerVersion, NOTICE_LONG_MS);
		if (readError !== null || loaded.invalid) {
			new Notice(TEXT.unreadable, NOTICE_LONG_MS);
			console.error('Study Curve: 設定ファイルを読み込めませんでした', readError);
		}
		if (loaded.resetKeys.length > 0) {
			// 手で書き換えた人向けの情報なので、起動のたびに通知はしない
			console.warn(
				`Study Curve: 設定の値が正しくないため既定値にしました：${loaded.resetKeys.join(', ')}`,
			);
		}
	}

	/**
	 * 同期のサービスや外部のプログラムが data.json を書き換えたときに Obsidian が呼ぶ（1.5.7）。
	 * 起動時と同じ経路で読み直し（新しい版なら保存を止める）、画面に反映する
	 */
	async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
		this.invalidateIndex();
		// 開いている設定画面は古い this.settings を指しているので、読み直した値で描き直す。
		// 描き直さないと、画面の入力が古い設定を書き換え、保存で読み直した設定が消える
		this.settingTab?.refreshIfShown();
	}

	/**
	 * 設定を保存し、開いている画面に反映する。新しい版の設定を読んだときと、読み直しの最中は保存しない
	 * （新しい版の設定を古い形で上書きしないため）。どちらも通知で知らせる
	 */
	async saveSettings(): Promise<void> {
		if (this.settingsLoad.isLoading()) {
			// 読み直す前の設定で、同期で来た新しい data.json を上書きしうる。この変更は読み直しで
			// this.settings が置き換わると消えるので、黙って捨てずに知らせる（読み直した後に設定画面が描き直される）
			new Notice(TEXT.saveDuringReload);
			return;
		}
		if (this.settingsSaveBlocked) {
			if (!this.saveBlockedNotified) {
				new Notice(TEXT.saveBlocked, NOTICE_LONG_MS);
				this.saveBlockedNotified = true;
			}
		} else {
			await this.saveData(this.settings);
		}
		// デッキ名・フォルダ・試験日は表示内容を変えるので、開いている画面に反映する。
		// 保存を止めている間も、変更はこの起動の間は効く（操作が途中で失敗したように見せない）
		this.invalidateIndex();
	}
}
