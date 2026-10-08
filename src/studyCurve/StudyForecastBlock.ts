import { MarkdownRenderChild } from 'obsidian';
import type StudyCurvePlugin from '../main';
import { parseBlockSource, parseNumberOption } from './blockUtils';
import { todayISO } from './dateUtils';
import { forecast } from './reviewQueue';
import { observeWidth } from './responsive';
import { renderEmpty, renderForecastChart } from './studyCardUI';

// 「これから何件こなす必要があるか」を先に見せるブロック。
// 山が高い日を見つけたら、前倒しで潰すか予定を送るかを判断する。
class StudyForecastChild extends MarkdownRenderChild {
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
		const days = parseNumberOption(
			this.options,
			'days',
			this.plugin.settings.forecastDays,
		);
		const notes = this.plugin.getIndex().notes.filter(
			(note) => !deckFilter || note.deck === deckFilter,
		);
		const rows = forecast(notes, today, Math.max(days, 1));
		const max = rows.reduce((peak, row) => Math.max(peak, row.count), 0);

		const head = this.containerEl.createDiv({ cls: 'study-curve-block-head' });
		head.createSpan({
			cls: 'study-curve-block-title',
			text: deckFilter
				? `今後${days}日の復習量（${deckFilter}）`
				: `今後${days}日の復習量`,
		});
		head.createSpan({
			cls: 'study-curve-count',
			text: `計${rows.reduce((sum, row) => sum + row.count, 0)}件`,
		});

		if (max === 0) {
			renderEmpty(this.containerEl, '予定されている復習はありません。');
			return;
		}

		renderForecastChart(this.containerEl, rows, today);
	}
}

export function registerStudyForecastBlock(plugin: StudyCurvePlugin): void {
	plugin.registerMarkdownCodeBlockProcessor(
		'study-forecast',
		(source, el, ctx) => {
			ctx.addChild(new StudyForecastChild(el, plugin, parseBlockSource(source)));
		},
	);
}
