import { ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type StudyCurvePlugin from '../main';
import { queueOptions } from '../settings';
import { formatShort, todayISO } from './dateUtils';
import { initialNextDate, parseIntervals } from './schedule';
import {
	DeckSummary,
	ForecastDay,
	buildQueue,
	forecast,
	summarizeDecks,
} from './reviewQueue';
import {
	StudyIndex,
	UnregisteredGroup,
	groupUnregisteredByDir,
} from './studyCache';
import { observeWidth } from './responsive';
import { ConfirmModal } from './ConfirmModal';
import { InferredDeck, inferDecksFromNotes } from './deckInference';
import { DeckEditModal } from './DeckEditModal';
import { EnrollConfirmInput, buildEnrollConfirm } from './enrollConfirm';
import { stageSegmentVars } from './chartVars';
import { renderEmpty, renderForecastChart, renderQueueRow, setBusy } from './studyCardUI';
import { findDeck } from './studyIndex';
import { DeckConfig, Grade, QueueItem } from './types';

export const VIEW_TYPE_STUDY_BOARD = 'study-curve-board';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	// まとめての処理（一括登録、#22 の名前の変更、#25 の解除）の最中に、未登録の欄の見出しに出す
	bulkRunning: '処理中…',
	// デッキが0件で、登録済みのノートがあるとき（案内A）
	foundTitle: '登録済みのノートが見つかりました',
	foundDesc:
		'設定にないデッキ名のノートがあります。デッキとして設定に追加すると、試験日からの逆算と、フォルダ内の未登録ノートの洗い出しが使えます。',
	// 推定したフォルダが、そのまま未登録ノートを探す範囲になることを、追加する前に伝える
	foundFolderNote:
		'フォルダは、登録済みのノートがある場所から推定しました。「未登録のノート」はこのフォルダの中だけを探します。ほかの場所のノートも探したいときは、「編集して追加」でフォルダを広げてください。',
	foundCount: (count: number) => `${count}件`,
	foundFolder: (folder: string) => `フォルダ：${folder === '' ? 'なし' : folder}`,
	editAndAdd: '編集して追加',
	addAll: 'すべて設定に追加',
	addedAll: (count: number) => `${count} 件のデッキを設定に追加しました`,
	// デッキが0件で、登録済みのノートもないとき（案内B）
	firstTitle: '最初のデッキを作りましょう',
	firstDesc:
		'デッキは、資格や科目ごとのノートのまとまりです。フォルダを指定すると、そのフォルダのノートをまとめて復習対象に登録できます。',
	createDeck: 'デッキを作成',
	created: (name: string) => `デッキ「${name}」を作成しました`,
	// 設定にないデッキ名のカード
	adopt: '設定に追加',
	adopted: (name: string) => `デッキ「${name}」を設定に追加しました`,
	noDeckFolder: 'デッキにフォルダを設定すると、そのフォルダの未登録ノートがここに出ます。',
	// 設定済みのデッキのカード（#10）
	addNote: 'ノート',
	addNoteLabel: 'このデッキに復習ノートを作成',
};

const ALL_DECKS = '__all__';

export class StudyBoardView extends ItemView {
	private deckFilter = ALL_DECKS;
	// 未登録ノートのフォルダ名フィルタと、開いているフォルダのキー（`デッキ名::フォルダ名`）。
	// ボード全体を再描画してもクリアされないよう、ここに持っておく。
	private unregisteredFilter = '';
	private openDirGroups = new Set<string>();
	private filterTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: StudyCurvePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_STUDY_BOARD;
	}

	getDisplayText(): string {
		return '復習ボード';
	}

	getIcon(): string {
		return 'brain';
	}

	async onOpen(): Promise<void> {
		this.register(this.plugin.onIndexChange(() => this.render()));
		const container = this.containerEl.children[1] as HTMLElement | undefined;
		// 画面回転・分割表示・サイドバーへの移動で幅が変わったら、
		// クラスの付け外しだけでレイアウトを切り替える（再描画はしない）。
		if (container) observeWidth(this, container);
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
	}

	private openNote(filePath: string): void {
		void this.app.workspace.openLinkText(filePath, '', false);
	}

	// 採点を記録できたら true。行は無効のまま、インデックスの更新による描き直しで消える。
	// ここで render() を呼ぶと、まだ古いインデックスで採点済みのノートが押せる状態のまま
	// 一覧に戻り、続けて押すと二重に記録されるので呼ばない。
	private async handleGrade(item: QueueItem, grade: Grade): Promise<boolean> {
		const result = await this.plugin.actions.grade(item.note.filePath, grade);
		if (!result) return false;
		if (this.plugin.settings.autoAdvance) {
			// この時点のインデックスはまだ古い（採点したノートが残っている）ので、
			// 採点したノートと、ほかの操作で処理中のノートを除いて先頭を開く。
			const next = this.currentQueue().find(
				(candidate) =>
					candidate.note.filePath !== item.note.filePath &&
					!this.plugin.actions.isBusy(candidate.note.filePath),
			);
			if (next) this.openNote(next.note.filePath);
		}
		return true;
	}

	private currentQueue(): QueueItem[] {
		const notes = this.plugin.getIndex().notes.filter(
			(note) => this.deckFilter === ALL_DECKS || note.deck === this.deckFilter,
		);
		return buildQueue(notes, queueOptions(this.plugin.settings), todayISO());
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement | undefined;
		if (!container) return;
		container.empty();
		container.addClass('study-curve-board');

		const settings = this.plugin.settings;
		const today = todayISO();
		const options = queueOptions(settings);
		const index = this.plugin.getIndex();
		const allNotes = index.notes;
		const summaries = summarizeDecks(allNotes, options, today);
		// 設定にないデッキ名のノート。デッキが0件なら案内に、1件以上なら「設定に追加」のフォルダに使う
		const inferred = inferDecksFromNotes(allNotes, settings.decks);

		// デッキを全部消した後などで、絞り込みが存在しないデッキを指していたら戻す
		if (
			this.deckFilter !== ALL_DECKS &&
			!summaries.some((summary) => summary.name === this.deckFilter)
		) {
			this.deckFilter = ALL_DECKS;
		}

		this.renderHeader(container, summaries, today);

		const scoped = allNotes.filter(
			(note) => this.deckFilter === ALL_DECKS || note.deck === this.deckFilter,
		);
		const queue = buildQueue(scoped, options, today);

		if (settings.decks.length > 0) {
			this.renderDeckCards(
				container,
				summaries.filter(
					(summary) =>
						this.deckFilter === ALL_DECKS || summary.name === this.deckFilter,
				),
				options.intervals.length,
				inferred,
			);
		} else if (inferred.length > 0) {
			// 案内A。カードは出さない。今日の復習などは今までどおり出す（デッキの設定がなくても動く）
			this.renderFoundDecksGuide(this.renderDeckSection(container), inferred);
		} else {
			// 案内B。今日の復習・予定・未登録の欄は、出すものがないので出さない
			this.renderFirstDeckGuide(this.renderDeckSection(container));
			return;
		}
		this.renderQueue(container, queue, today, options.intervals.length - 1);
		this.renderForecast(
			container,
			forecast(scoped, today, settings.forecastDays),
			today,
		);
		this.renderUnregistered(container, index);
	}

	private renderHeader(
		container: HTMLElement,
		summaries: DeckSummary[],
		today: string,
	): void {
		const header = container.createDiv({ cls: 'study-curve-header' });
		header.createDiv({
			cls: 'study-curve-today',
			text: `今日 ${formatShort(today)}`,
		});

		const select = header.createEl('select', { cls: 'dropdown study-curve-deck-filter' });
		select.createEl('option', { value: ALL_DECKS, text: 'すべてのデッキ' });
		for (const summary of summaries) {
			select.createEl('option', { value: summary.name, text: summary.name });
		}
		select.value = this.deckFilter;
		select.addEventListener('change', () => {
			this.deckFilter = select.value;
			this.render();
		});

		const refresh = header.createEl('button', {
			cls: 'study-curve-refresh',
			attr: { 'aria-label': '再読み込み' },
		});
		setIcon(refresh, 'refresh-cw');
		refresh.addEventListener('click', () => this.render());
	}

	private renderDeckSection(container: HTMLElement): HTMLElement {
		const section = container.createDiv({ cls: 'study-curve-section' });
		section.createEl('h3', { text: 'デッキ' });
		return section;
	}

	/** 案内A：デッキが0件で、登録済みのノートがあるとき。見つかったデッキを設定に取り込む */
	private renderFoundDecksGuide(section: HTMLElement, inferred: InferredDeck[]): void {
		const guide = section.createDiv({ cls: 'study-curve-onboarding' });
		guide.createDiv({ cls: 'study-curve-onboarding-title', text: TEXT.foundTitle });
		guide.createDiv({ cls: 'study-curve-onboarding-desc', text: TEXT.foundDesc });
		guide.createDiv({ cls: 'study-curve-onboarding-desc', text: TEXT.foundFolderNote });

		for (const deck of inferred) {
			const row = guide.createDiv({ cls: 'study-curve-onboarding-row' });
			row.createSpan({ cls: 'study-curve-onboarding-name', text: deck.name });
			row.createSpan({ cls: 'study-curve-count', text: TEXT.foundCount(deck.count) });
			row.createSpan({
				cls: 'study-curve-onboarding-folder',
				text: TEXT.foundFolder(deck.folder),
			});
			row.createEl('button', { text: TEXT.editAndAdd }).addEventListener('click', () => {
				this.openAdoptDialog(deck.name, deck.folder);
			});
		}

		const actions = guide.createDiv({ cls: 'study-curve-onboarding-actions' });
		const addAll = actions.createEl('button', { cls: 'mod-cta', text: TEXT.addAll });
		addAll.addEventListener('click', () => {
			// 保存して描き直されるまで、案内のボタンをすべて無効にする（連打しても1回）
			setBusy(guide, true);
			void this.plugin.actions
				.addDecks(
					inferred.map((deck) => ({ name: deck.name, folder: deck.folder, examDate: null })),
				)
				.then((added) => {
					if (added !== null && added > 0) new Notice(TEXT.addedAll(added));
					else setBusy(guide, false); // 保存に失敗した（通知は actions が出す）
				});
		});
	}

	/** 案内B：デッキが0件で、登録済みのノートもないとき。最初のデッキを作る */
	private renderFirstDeckGuide(section: HTMLElement): void {
		const guide = section.createDiv({ cls: 'study-curve-onboarding' });
		guide.createDiv({ cls: 'study-curve-onboarding-title', text: TEXT.firstTitle });
		guide.createDiv({ cls: 'study-curve-onboarding-desc', text: TEXT.firstDesc });
		const actions = guide.createDiv({ cls: 'study-curve-onboarding-actions' });
		const create = actions.createEl('button', { cls: 'mod-cta', text: TEXT.createDeck });
		create.addEventListener('click', () => {
			new DeckEditModal(this.app, {
				mode: 'create',
				existingNames: () => this.plugin.settings.decks.map((deck) => deck.name),
				onSubmit: async (deck) => {
					const added = await this.plugin.actions.addDecks([deck]);
					if (added === null) return false; // 保存に失敗（通知は actions が出す）
					if (added > 0) new Notice(TEXT.created(deck.name));
					return true;
				},
			}).open();
		});
	}

	/** ノートにあるデッキ名を、フォルダと試験日を直してから設定に追加するダイアログ */
	private openAdoptDialog(name: string, folder: string): void {
		new DeckEditModal(this.app, {
			mode: 'adopt',
			initial: { name, folder, examDate: null },
			existingNames: () => this.plugin.settings.decks.map((deck) => deck.name),
			onSubmit: async (deck) => {
				const added = await this.plugin.actions.addDecks([deck]);
				if (added === null) return false; // 保存に失敗（通知は actions が出す）
				if (added > 0) new Notice(TEXT.adopted(deck.name));
				return true;
			},
		}).open();
	}

	private renderDeckCards(
		container: HTMLElement,
		summaries: DeckSummary[],
		stageSlots: number,
		inferred: InferredDeck[],
	): void {
		const section = this.renderDeckSection(container);
		if (summaries.length === 0) {
			renderEmpty(section, 'デッキがありません。設定から追加してください。');
			return;
		}

		const grid = section.createDiv({ cls: 'study-curve-deck-grid' });
		for (const summary of summaries) {
			const card = grid.createDiv({
				cls: summary.sprint
					? 'study-curve-deck-card is-sprint'
					: 'study-curve-deck-card',
			});
			card.createDiv({ cls: 'study-curve-deck-name', text: summary.name });

			const exam = card.createDiv({ cls: 'study-curve-deck-exam' });
			if (summary.daysToExam === null) {
				exam.setText('試験日 未設定');
			} else if (summary.daysToExam < 0) {
				exam.setText(`試験日 ${formatShort(summary.examDate!)}（終了）`);
			} else if (summary.daysToExam === 0) {
				exam.setText('試験日 当日');
				exam.addClass('is-urgent');
			} else {
				exam.setText(`試験まで あと${summary.daysToExam}日`);
				if (summary.sprint) exam.addClass('is-urgent');
			}

			const stats = card.createDiv({ cls: 'study-curve-deck-stats' });
			stats.createSpan({ text: `登録 ${summary.total}` });
			stats.createSpan({ text: `今日 ${summary.dueCount}` });
			if (summary.overdueCount > 0) {
				stats.createSpan({
					cls: 'is-overdue',
					text: `遅延 ${summary.overdueCount}`,
				});
			}
			if (summary.suspended > 0) {
				stats.createSpan({ text: `休止 ${summary.suspended}` });
			}

			// ステージ分布。左（S0＝未定着）が厚いほど、まだ回り始めたばかり。
			const bar = card.createDiv({ cls: 'study-curve-stage-bar' });
			const total = summary.stageCounts.reduce((sum, n) => sum + n, 0);
			if (total === 0) {
				bar.addClass('is-empty');
			} else {
				summary.stageCounts.forEach((count, index) => {
					if (count === 0) return;
					const segment = bar.createDiv({
						cls: 'study-curve-stage-segment',
						attr: { 'aria-label': `ステージ${index}: ${count}件` },
					});
					// 件数（幅の比）と濃さは値だけを CSS 変数で渡し、styles.css で使う（#7）
					segment.setCssProps(stageSegmentVars(count, index, stageSlots));
					segment.setText(count >= 3 ? String(count) : '');
				});
			}
			card.createDiv({
				cls: 'study-curve-deck-retention',
				text: `定着度 ${Math.round(summary.retention * 100)}%`,
			});

			// 設定済みのデッキだけ。設定にないデッキ名のカードには、下の「設定に追加」が出る
			const deck = summary.configured ? findDeck(summary.name, this.plugin.settings.decks) : null;
			if (deck) {
				const addNote = card.createEl('button', {
					cls: 'study-curve-deck-add-note',
					attr: { 'aria-label': TEXT.addNoteLabel },
				});
				setIcon(addNote.createSpan(), 'plus');
				addNote.createSpan({ text: TEXT.addNote });
				addNote.addEventListener('click', () => this.plugin.openCreateNoteDialog(deck));
			}

			if (!summary.configured) {
				card.createDiv({
					cls: 'study-curve-deck-warning',
					text: '設定に無いデッキ名です',
				});
				const folder = inferred.find((deck) => deck.name === summary.name)?.folder ?? '';
				card
					.createEl('button', { cls: 'study-curve-deck-adopt', text: TEXT.adopt })
					.addEventListener('click', () => this.openAdoptDialog(summary.name, folder));
			}
		}
	}

	private renderQueue(
		container: HTMLElement,
		queue: QueueItem[],
		today: string,
		maxStage: number,
	): void {
		const section = container.createDiv({ cls: 'study-curve-section' });
		const heading = section.createEl('h3', { text: '今日の復習' });
		heading.createSpan({
			cls: 'study-curve-count',
			text: `${queue.length}件`,
		});

		if (queue.length === 0) {
			renderEmpty(section, '今日の復習はありません。お疲れさまでした。');
			return;
		}

		const list = section.createDiv({ cls: 'study-curve-list' });
		for (const item of queue) {
			renderQueueRow(list, item, today, maxStage, {
				onOpen: (path) => this.openNote(path),
				onGrade: (target, grade) => this.handleGrade(target, grade),
				// 送れたら true。通知は actions が実際の日付で出す。行は無効のまま、インデックスの
				// 更新による描き直しで消える（直後に render() を呼ぶと、古いインデックスで押せる行が戻る）
				onPostpone: async (target) => (await this.plugin.actions.postpone(target.note)) !== null,
				onUnenroll: async (target) => {
					this.plugin.confirmUnenroll(target.note);
					return false;
				},
				isBusy: (path) => this.plugin.actions.isBusy(path),
			});
		}
	}

	private renderForecast(
		container: HTMLElement,
		days: ForecastDay[],
		today: string,
	): void {
		const section = container.createDiv({ cls: 'study-curve-section' });
		section.createEl('h3', { text: 'これからの復習量' });
		const max = days.reduce((peak, day) => Math.max(peak, day.count), 0);
		if (max === 0) {
			renderEmpty(section, '予定されている復習はありません。');
			return;
		}

		renderForecastChart(section, days, today);
	}

	private renderUnregistered(container: HTMLElement, index: StudyIndex): void {
		const section = container.createDiv({ cls: 'study-curve-section' });

		const head = section.createDiv({ cls: 'study-curve-unregistered-head-row' });
		const heading = head.createEl('h3', { text: '未登録のノート' });
		// まとめての処理の最中は、描き直しても分かるように見出しに出す（登録のボタンは押せない）
		if (this.plugin.actions.isBulkRunning()) {
			heading.createSpan({ cls: 'study-curve-enrolling', text: TEXT.bulkRunning });
		}
		const filterInput = head.createEl('input', {
			cls: 'study-curve-dir-filter',
			attr: { type: 'text', placeholder: 'フォルダ名で絞り込み' },
		});
		filterInput.value = this.unregisteredFilter;

		const body = section.createDiv({ cls: 'study-curve-unregistered-body' });
		// フォルダの開閉やフィルタ入力のたびにボード全体を作り直すと、
		// 入力中のフォーカスが飛んだり、他セクションまで再計算したりするので、
		// この本文だけを差し替える。
		const repaint = () => {
			body.empty();
			this.renderUnregisteredBody(body, index, repaint);
		};

		filterInput.addEventListener('input', () => {
			this.unregisteredFilter = filterInput.value;
			if (this.filterTimer !== null) window.clearTimeout(this.filterTimer);
			this.filterTimer = window.setTimeout(() => {
				this.filterTimer = null;
				repaint();
			}, 150);
		});

		repaint();
	}

	private renderUnregisteredBody(
		body: HTMLElement,
		index: StudyIndex,
		repaint: () => void,
	): void {
		// 確認の文言には、この一覧を描いた時点の絞り込みを使う（入力の直後に押しても食い違わない）
		const filterText = this.unregisteredFilter;
		const needle = filterText.trim().toLowerCase();
		// 処理中はボタンをすべて無効にする。処理中も登録のたびに描き直されるので、毎回ここで見る
		const bulkRunning = this.plugin.actions.isBulkRunning();
		const decks = this.plugin.settings.decks.filter(
			(deck) =>
				deck.folder !== '' &&
				(this.deckFilter === ALL_DECKS || deck.name === this.deckFilter),
		);

		let shownGroups = 0;

		for (const deck of decks) {
			const groups = groupUnregisteredByDir(index, deck).filter((group) => {
				if (needle === '') return true;
				const label = group.dir === '' ? deck.name : group.dir;
				return (
					label.toLowerCase().includes(needle) ||
					deck.name.toLowerCase().includes(needle)
				);
			});
			if (groups.length === 0) continue;
			shownGroups += groups.length;

			const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
			const deckWrap = body.createDiv({ cls: 'study-curve-unregistered' });
			const deckHead = deckWrap.createDiv({ cls: 'study-curve-unregistered-head' });
			deckHead.createSpan({ text: `${deck.name}（${totalFiles}件）` });
			const enrollAll = deckHead.createEl('button', {
				cls: 'study-curve-enroll-all',
				text: 'すべて登録',
			});
			enrollAll.disabled = bulkRunning;
			enrollAll.addEventListener('click', () => {
				// 対象は表示中のグループ（絞り込み中はその範囲）。件数によらず必ず確認する
				this.confirmEnroll(deck, groups.flatMap((g) => g.files), {
					kind: 'deck',
					filter: filterText,
				});
			});

			for (const group of groups) {
				this.renderDirGroup(deckWrap, deck, group, repaint, bulkRunning);
			}
		}

		if (decks.length === 0) {
			// フォルダ付きのデッキがない（調べる対象がない）
			renderEmpty(body, TEXT.noDeckFolder);
		} else if (shownGroups === 0) {
			renderEmpty(
				body,
				needle === ''
					? 'デッキフォルダ内のノートはすべて登録済みです。'
					: `「${this.unregisteredFilter}」に一致するフォルダはありません。`,
			);
		}
	}

	// フォルダ1つ分のアコーディオン。開閉状態は openDirGroups に持つので、
	// クリックのたびに repaint() で本文だけ描き直せば見た目が保たれる。
	private renderDirGroup(
		parent: HTMLElement,
		deck: DeckConfig,
		group: UnregisteredGroup,
		repaint: () => void,
		bulkRunning: boolean,
	): void {
		const label = group.dir === '' ? '（直下）' : group.dir;
		const key = `${deck.name}::${group.dir}`;
		const isOpen = this.openDirGroups.has(key);

		const groupEl = parent.createDiv({ cls: 'study-curve-dir-group' });
		const header = groupEl.createDiv({
			cls: 'study-curve-dir-group-head',
			attr: { role: 'button', tabindex: '0' },
		});
		const chevron = header.createSpan({ cls: 'study-curve-dir-group-chevron' });
		setIcon(chevron, isOpen ? 'chevron-down' : 'chevron-right');
		header.createSpan({
			cls: 'study-curve-dir-group-label',
			text: `${label}（${group.files.length}件）`,
		});
		const groupEnroll = header.createEl('button', {
			cls: 'study-curve-dir-group-enroll',
			text: '登録',
		});
		groupEnroll.disabled = bulkRunning;
		groupEnroll.addEventListener('click', (event) => {
			event.stopPropagation();
			// 1件だけなら、その1件の「登録」を押したのと同じなので確認しない
			if (group.files.length === 1) {
				this.enroll(group.files, deck);
				return;
			}
			this.confirmEnroll(deck, group.files, { kind: 'folder', dir: group.dir });
		});

		const toggle = () => {
			if (this.openDirGroups.has(key)) this.openDirGroups.delete(key);
			else this.openDirGroups.add(key);
			repaint();
		};
		header.addEventListener('click', toggle);
		header.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				toggle();
			}
		});

		if (!isOpen) return;

		const list = groupEl.createDiv({ cls: 'study-curve-dir-group-body' });
		for (const file of group.files) {
			const row = list.createDiv({ cls: 'study-curve-unregistered-row' });
			const link = row.createSpan({
				cls: 'internal-link is-clickable',
				text: file.basename,
			});
			link.addEventListener('click', () => this.openNote(file.path));
			const button = row.createEl('button', { text: '登録' });
			button.disabled = bulkRunning;
			// 1件ずつの登録は確認しない
			button.addEventListener('click', () => this.enroll([file], deck));
		}
	}

	/** まとめての登録の確認ダイアログを開く。確定したら処理を始めるだけで、すぐ閉じる */
	private confirmEnroll(
		deck: DeckConfig,
		files: TFile[],
		scope: EnrollConfirmInput['scope'],
	): void {
		// 確認に出す初回の復習日と、実際に登録する日付を同じ「今日」から決める
		// （ダイアログを開いたまま、または登録の途中で日付をまたいでも食い違わない）
		const today = todayISO();
		const firstReview = initialNextDate(
			parseIntervals(this.plugin.settings.intervalsRaw),
			today,
			deck.examDate,
		);
		const options = buildEnrollConfirm({
			deckName: deck.name,
			deckFolder: deck.folder,
			filePaths: files.map((file) => file.path),
			scope,
			firstReviewLabel: formatShort(firstReview),
		});
		// 処理の終わりを待たずに閉じる。長い処理のあいだダイアログがほかの操作を塞がないように
		// （iPad）。進み具合と結果は StudyActions が通知で出す
		new ConfirmModal(this.app, options, () => this.enroll(files, deck, today)).open();
	}

	/**
	 * 登録を始める。進み具合と結果の通知は StudyActions が出す。
	 * 始めたらすぐ描き直し、最初の書き込みの反映を待たずに、登録のボタンをすべて無効にして
	 * 「処理中…」を出す（enrollMany は最初の書き込みの前に処理中の印を付ける）。
	 * 終わったら描き直して、無効にしていたボタンを戻す（登録したノートは、書き込んだ状態が
	 * インデックスに使われるので、キャッシュが古くても未登録の一覧に戻らない）
	 * @param today 初回の復習日の基準日。確認ダイアログを出したときは、そこに出した日付の基準日
	 */
	private enroll(files: TFile[], deck: DeckConfig, today?: string): void {
		const running = this.plugin.actions.enrollMany(files, deck, today);
		this.render();
		void running.then(() => this.render());
	}
}
