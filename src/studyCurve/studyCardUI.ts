import { setIcon } from 'obsidian';
import { forecastBarVars, forecastOverdueVars } from './chartVars';
import { formatShort, relativeLabel } from './dateUtils';
import type { ForecastDay } from './reviewQueue';
import {
	Grade,
	GRADE_LABELS,
	GRADE_SYMBOLS,
	GRADE_TEXTS,
	QueueItem,
	StudyNote,
} from './types';

const REASON_LABELS: Record<QueueItem['reason'], string> = {
	overdue: '遅延',
	due: '今日',
	sprint: '直前',
};

export interface QueueRowCallbacks {
	onOpen: (filePath: string) => void;
	/** 記録できたら true。false なら行のボタンを押せる状態に戻す */
	onGrade: (item: QueueItem, grade: Grade) => Promise<boolean>;
	/** 送れたら true。false なら行のボタンを押せる状態に戻す */
	onPostpone?: (item: QueueItem) => Promise<boolean>;
	// 復習対象からの解除。ステージ・履歴を失うので、呼び出し側で確認を挟む想定。
	// 確認ダイアログを開くだけなので、押しても行は無効にしない。
	onUnenroll?: (item: QueueItem) => Promise<boolean>;
	/** 描画の時点で処理中なら、行を最初から無効にして描く */
	isBusy?: (filePath: string) => boolean;
}

/** 行（や任意の要素）を処理中にする。中のボタンをすべて無効にする */
export function setBusy(el: HTMLElement, busy: boolean): void {
	el.toggleClass('is-busy', busy);
	el.setAttr('aria-busy', busy ? 'true' : 'false');
	el.querySelectorAll('button').forEach((button) => {
		button.disabled = busy;
	});
}

// 直近の手応えを小さな点で並べる。何回連続で落としているかが
// 数字を読まなくても分かるようにするため。
export function renderHistoryDots(parent: HTMLElement, note: StudyNote): void {
	const wrap = parent.createDiv({ cls: 'study-curve-history' });
	const recent = note.history.slice(-6);
	if (recent.length === 0) {
		wrap.createSpan({ cls: 'study-curve-history-empty', text: '初回' });
		return;
	}
	for (const entry of recent) {
		wrap.createSpan({
			cls: `study-curve-dot study-curve-dot-${entry.grade}`,
			attr: { 'aria-label': `${entry.date} ${GRADE_LABELS[entry.grade]}` },
		});
	}
}

export function renderStageBadge(
	parent: HTMLElement,
	note: StudyNote,
	maxStage: number,
): void {
	parent.createSpan({
		cls: 'study-curve-badge study-curve-badge-stage',
		text: `S${note.stage}/${maxStage}`,
		attr: { 'aria-label': `復習ステージ ${note.stage}` },
	});
}

// 復習キューの1行。ボード本体と日次ノートのコードブロックで同じ見た目にするため
// ここに切り出している。
export function renderQueueRow(
	parent: HTMLElement,
	item: QueueItem,
	todayISO: string,
	maxStage: number,
	callbacks: QueueRowCallbacks,
): HTMLElement {
	const row = parent.createDiv({
		cls: `study-curve-row study-curve-row-${item.reason}`,
	});

	// 行の操作を1つ実行する。押した時点で行を無効にし、記録できなかったときだけ戻す。
	// 成功したときは無効のままにして、インデックスの更新による描き直しで行が消えるのを待つ
	// （その前に押し直して二重に記録しないため）。
	// 別の画面（ボードとブロック）で同じノートを処理中なら、何もせず無効のままにする。
	// 戻すと、先の処理が終わってから描き直しまでの間に押し直せてしまう。
	// 行は、先の処理の完了後の描き直しで新しい状態になる（StudyActions.exclusive）。
	const run = (action: () => Promise<boolean>) => {
		setBusy(row, true);
		if (callbacks.isBusy?.(item.note.filePath)) return;
		void action()
			.then((ok) => {
				if (!ok) setBusy(row, false);
			})
			.catch(() => setBusy(row, false));
	};

	const main = row.createDiv({ cls: 'study-curve-row-main' });

	const title = main.createDiv({ cls: 'study-curve-row-title' });
	const link = title.createSpan({
		cls: 'internal-link is-clickable study-curve-link',
		text: item.note.basename,
	});
	link.addEventListener('click', () => callbacks.onOpen(item.note.filePath));

	const meta = main.createDiv({ cls: 'study-curve-row-meta' });
	meta.createSpan({
		cls: 'study-curve-badge study-curve-badge-deck',
		text: item.note.deck,
	});
	meta.createSpan({
		cls: `study-curve-badge study-curve-badge-${item.reason}`,
		text: REASON_LABELS[item.reason],
	});
	renderStageBadge(meta, item.note, maxStage);
	if (item.note.nextDate) {
		meta.createSpan({
			cls: 'study-curve-row-date',
			text: `${relativeLabel(item.note.nextDate, todayISO)}・${formatShort(item.note.nextDate)}`,
		});
	} else {
		meta.createSpan({ cls: 'study-curve-row-date', text: '未スケジュール' });
	}
	renderHistoryDots(meta, item.note);

	const actions = row.createDiv({ cls: 'study-curve-row-actions' });
	// ☆（初見）は左端。読んだ直後に「そもそも初めて見た」を先に振り分けたいため。
	const grades: Grade[] = ['fresh', 'again', 'hard', 'good'];
	for (const grade of grades) {
		const button = actions.createEl('button', {
			cls: `study-curve-grade study-curve-grade-${grade}`,
			attr: { 'aria-label': GRADE_LABELS[grade] },
		});
		button.createSpan({
			cls: 'study-curve-grade-symbol',
			text: GRADE_SYMBOLS[grade],
		});
		button.createSpan({
			cls: 'study-curve-grade-text',
			text: GRADE_TEXTS[grade],
		});
		button.addEventListener('click', () => run(() => callbacks.onGrade(item, grade)));
	}
	const { onPostpone } = callbacks;
	// 直前総ざらい中のデッキは予定日に関係なく全件が一覧に出るので、送っても消えない。
	// 押せないボタンを並べるより出さないほうが分かりやすい（iPad ではツールチップも出ない）
	if (onPostpone && !item.inSprint) {
		const postpone = actions.createEl('button', {
			cls: 'study-curve-postpone',
			attr: { 'aria-label': '明日に送る' },
		});
		setIcon(postpone, 'clock');
		postpone.addEventListener('click', () => run(() => onPostpone(item)));
	}
	if (callbacks.onUnenroll) {
		const unenroll = actions.createEl('button', {
			cls: 'study-curve-unenroll',
			attr: { 'aria-label': '復習対象から解除' },
		});
		setIcon(unenroll, 'trash-2');
		unenroll.addEventListener('click', () => {
			void callbacks.onUnenroll?.(item);
		});
	}

	// 別の画面（ボードとブロック）で押されて処理中のノートは、最初から押せない状態で描く
	if (callbacks.isBusy?.(item.note.filePath)) setBusy(row, true);

	return row;
}

export function renderEmpty(parent: HTMLElement, text: string): void {
	parent.createDiv({ cls: 'study-curve-empty', text });
}

/**
 * 予定グラフ（日ごとの棒と日付）を parent の中に描く。復習ボードと study-forecast ブロックで使う（#7）。
 * 件数がすべて0のときの「予定されている復習はありません」は、呼び出し側で出す
 */
export function renderForecastChart(parent: HTMLElement, days: ForecastDay[], today: string): void {
	const max = days.reduce((peak, day) => Math.max(peak, day.count), 0);
	const chart = parent.createDiv({ cls: 'study-curve-forecast' });
	for (const day of days) {
		const isToday = day.date === today;
		const barClasses = ['study-curve-forecast-bar'];
		// is-today は色には使っていない（#90）。テーマや CSS スニペットから今日の棒を選べるように残す
		if (isToday) barClasses.push('is-today');
		if (day.overdue > 0) barClasses.push('has-overdue');
		const column = chart.createDiv({ cls: 'study-curve-forecast-col' });
		const bar = column.createDiv({
			cls: barClasses,
			attr: {
				'aria-label':
					day.overdue > 0
						? `${day.date}: ${day.count}件（うち遅れ ${day.overdue}件）`
						: `${day.date}: ${day.count}件`,
			},
		});
		// 高さは値だけを CSS 変数で渡し、styles.css の height で使う（テーマから上書きできるように）。
		// 遅れがある日（今日）は、棒のうち遅れの分の割合も渡し、styles.css で色を分ける（#90）
		bar.setCssProps(
			day.overdue > 0
				? { ...forecastBarVars(day.count, max), ...forecastOverdueVars(day.overdue, day.count) }
				: forecastBarVars(day.count, max),
		);
		if (day.count > 0) bar.createSpan({ text: String(day.count) });
		column.createDiv({
			cls: isToday ? 'study-curve-forecast-label is-today' : 'study-curve-forecast-label',
			text: formatShort(day.date).replace(/\(.\)$/, ''),
		});
	}
}
