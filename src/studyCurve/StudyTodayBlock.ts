import { MarkdownRenderChild } from 'obsidian';
import type StudyCurvePlugin from '../main';
import { queueOptions } from '../settings';
import { parseBlockSource, parseNumberOption } from './blockUtils';
import { todayISO } from './dateUtils';
import { buildQueue } from './reviewQueue';
import { observeWidth } from './responsive';
import { renderEmpty, renderQueueRow } from './studyCardUI';

// 日次ノートに貼る「今日の復習」ブロック。復習ボードを開かなくても
// デイリーノートの流れの中で採点まで済ませられるようにする。
class StudyTodayChild extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private plugin: StudyCurvePlugin,
		private options: Record<string, string>,
	) {
		super(containerEl);
	}

	onload(): void {
		this.register(this.plugin.onIndexChange(() => this.render()));
		observeWidth(this, this.containerEl);
		this.render();
	}

	private render(): void {
		this.containerEl.empty();
		this.containerEl.addClass('study-curve-block');

		const settings = this.plugin.settings;
		const today = todayISO();
		const deckFilter = this.options['deck'];
		const notes = this.plugin.getIndex().notes.filter(
			(note) => !deckFilter || note.deck === deckFilter,
		);

		const limit = parseNumberOption(this.options, 'limit', settings.dailyLimit);
		const options = { ...queueOptions(settings), dailyLimit: limit };
		const queue = buildQueue(notes, options, today);
		const maxStage = options.intervals.length - 1;

		const head = this.containerEl.createDiv({ cls: 'study-curve-block-head' });
		head.createSpan({
			cls: 'study-curve-block-title',
			text: deckFilter ? `今日の復習（${deckFilter}）` : '今日の復習',
		});
		head.createSpan({ cls: 'study-curve-count', text: `${queue.length}件` });

		if (queue.length === 0) {
			renderEmpty(this.containerEl, '今日の復習はありません。');
			return;
		}

		const list = this.containerEl.createDiv({ cls: 'study-curve-list' });
		for (const item of queue) {
			renderQueueRow(list, item, today, maxStage, {
				onOpen: (path) => {
					void this.plugin.app.workspace.openLinkText(path, '', false);
				},
				// 記録できたら true。行は無効のまま、インデックスの更新による描き直しで消える
				// （直後に render() を呼ぶと、古いインデックスで押せる行が戻ってくるため呼ばない）。
				// ブロックでは autoAdvance をしない（デイリーノートを読んでいる途中で移らないため）。
				onGrade: async (target, grade) =>
					(await this.plugin.actions.grade(target.note.filePath, grade)) !== null,
				// 採点と同じく、送れたら true。通知はボードと同じく actions が出す
				onPostpone: async (target) => (await this.plugin.actions.postpone(target.note)) !== null,
				onUnenroll: async (target) => {
					this.plugin.confirmUnenroll(target.note);
					return false;
				},
				isBusy: (path) => this.plugin.actions.isBusy(path),
			});
		}
	}
}

export function registerStudyTodayBlock(plugin: StudyCurvePlugin): void {
	plugin.registerMarkdownCodeBlockProcessor('study-today', (source, el, ctx) => {
		ctx.addChild(new StudyTodayChild(el, plugin, parseBlockSource(source)));
	});
}
