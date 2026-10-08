import { MarkdownRenderChild } from 'obsidian';
import type StudyCurvePlugin from '../main';
import { queueOptions } from '../settings';
import { parseBlockSource } from './blockUtils';
import { formatShort, todayISO } from './dateUtils';
import { summarizeDecks } from './reviewQueue';
import { observeWidth } from './responsive';
import { renderEmpty } from './studyCardUI';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	noDecks: 'デッキがありません。復習ボードから作成できます。',
};

function examCell(
	daysLeft: number | null,
	examDate: string | null,
): { text: string; urgent: boolean } {
	if (daysLeft === null || examDate === null) return { text: '—', urgent: false };
	if (daysLeft < 0) return { text: `${formatShort(examDate)} 終了`, urgent: false };
	if (daysLeft === 0) return { text: '本日', urgent: true };
	return { text: `${formatShort(examDate)}（あと${daysLeft}日）`, urgent: daysLeft <= 7 };
}

// 週次レビューに貼る想定のサマリー表。デッキごとに
// 「試験日まで／登録数／今日やる分／遅延／定着度」を1行で並べる。
class StudyProgressChild extends MarkdownRenderChild {
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

		const today = todayISO();
		const deckFilter = this.options['deck'];
		const notes = this.plugin.getIndex().notes;
		const summaries = summarizeDecks(
			notes,
			queueOptions(this.plugin.settings),
			today,
		).filter((summary) => !deckFilter || summary.name === deckFilter);

		this.containerEl
			.createDiv({ cls: 'study-curve-block-head' })
			.createSpan({ cls: 'study-curve-block-title', text: '学習の進捗' });

		if (summaries.length === 0) {
			renderEmpty(this.containerEl, TEXT.noDecks);
			return;
		}

		const table = this.containerEl.createEl('table', {
			cls: 'study-curve-progress-table',
		});
		const headRow = table.createEl('thead').createEl('tr');
		for (const label of ['デッキ', '試験日', '登録', '今日', '遅延', '定着度']) {
			headRow.createEl('th', { text: label });
		}

		const tbody = table.createEl('tbody');
		for (const summary of summaries) {
			const row = tbody.createEl('tr');
			row.createEl('td', { text: summary.name });
			const exam = examCell(summary.daysToExam, summary.examDate);
			const examTd = row.createEl('td', { text: exam.text });
			if (exam.urgent) examTd.addClass('is-urgent');
			row.createEl('td', { text: String(summary.total) });
			row.createEl('td', { text: String(summary.dueCount) });
			const overdueTd = row.createEl('td', { text: String(summary.overdueCount) });
			if (summary.overdueCount > 0) overdueTd.addClass('is-overdue');
			row.createEl('td', { text: `${Math.round(summary.retention * 100)}%` });
		}
	}
}

export function registerStudyProgressBlock(plugin: StudyCurvePlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		'study-progress',
		(source, el, ctx) => {
			ctx.addChild(new StudyProgressChild(el, plugin, parseBlockSource(source)));
		},
	);
}
