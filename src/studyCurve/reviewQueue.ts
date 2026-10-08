import { addDays, daysBetween } from './dateUtils';
import { retentionRatio } from './schedule';
import { findDeck } from './studyIndex';
import { DeckConfig, QueueItem, QueueReason, StudyNote } from './types';

export interface QueueOptions {
	decks: DeckConfig[];
	intervals: number[];
	// 試験日までこの日数を切ったデッキは、予定日に関係なく全ノートを出す（直前総ざらい）
	finalSprintDays: number;
	// 1日に出す上限。0 で無制限
	dailyLimit: number;
}

export function daysToExam(
	examDate: string | null,
	todayISO: string,
): number | null {
	if (!examDate) return null;
	return daysBetween(todayISO, examDate);
}

export function isSprintDeck(
	deck: DeckConfig | null,
	todayISO: string,
	finalSprintDays: number,
): boolean {
	const remaining = daysToExam(deck?.examDate ?? null, todayISO);
	if (remaining === null) return false;
	return remaining >= 0 && remaining <= finalSprintDays;
}

const REASON_ORDER: Record<QueueReason, number> = {
	overdue: 0,
	due: 1,
	sprint: 2,
};

// 今日やるべき復習の並び。遅れているものを先頭に、次に予定日ちょうどのもの、
// 最後に直前総ざらいの前倒し分。同順位ならステージが低い（＝まだ定着していない）
// 順に出す。試験が近いのに苦手項目が後回しになるのを避けるため。
export function buildQueue(
	notes: StudyNote[],
	options: QueueOptions,
	todayISO: string,
): QueueItem[] {
	const items: QueueItem[] = [];

	for (const note of notes) {
		if (note.suspended) continue;
		const deck = findDeck(note.deck, options.decks);
		const sprint = isSprintDeck(deck, todayISO, options.finalSprintDays);

		// 予定日が未設定のノートは「登録したが一度も出ていない」状態なので今日出す。
		if (note.nextDate === null) {
			items.push({ note, reason: 'due', overdueDays: 0, inSprint: sprint });
			continue;
		}

		const overdueDays = daysBetween(note.nextDate, todayISO);
		if (overdueDays > 0) {
			items.push({ note, reason: 'overdue', overdueDays, inSprint: sprint });
		} else if (overdueDays === 0) {
			items.push({ note, reason: 'due', overdueDays: 0, inSprint: sprint });
		} else if (sprint) {
			items.push({ note, reason: 'sprint', overdueDays, inSprint: true });
		}
	}

	items.sort((a, b) => {
		const byReason = REASON_ORDER[a.reason] - REASON_ORDER[b.reason];
		if (byReason !== 0) return byReason;
		if (a.overdueDays !== b.overdueDays) return b.overdueDays - a.overdueDays;
		if (a.note.stage !== b.note.stage) return a.note.stage - b.note.stage;
		return a.note.basename.localeCompare(b.note.basename, 'ja');
	});

	return options.dailyLimit > 0 ? items.slice(0, options.dailyLimit) : items;
}

export interface ForecastDay {
	date: string;
	count: number;
	// count のうち、予定日を過ぎていて今日に数えた件数。今日以外の日は 0（#90）
	overdue: number;
}

// 今後 days 日分の復習予定件数。山ができている日を事前に見つけて、
// 前倒しや後ろ倒しを判断するために使う。
export function forecast(
	notes: StudyNote[],
	todayISO: string,
	days: number,
): ForecastDay[] {
	const counts = new Map<string, ForecastDay>();
	for (let i = 0; i < days; i++) {
		const date = addDays(todayISO, i);
		counts.set(date, { date, count: 0, overdue: 0 });
	}
	for (const note of notes) {
		if (note.suspended || note.nextDate === null) continue;
		// 期限切れは今日の山として数える。グラフで色を分けられるように、遅れの件数も別に数える
		const overdue = note.nextDate < todayISO;
		const day = counts.get(overdue ? todayISO : note.nextDate);
		if (!day) continue;
		day.count++;
		if (overdue) day.overdue++;
	}
	return [...counts.values()];
}

export interface DeckSummary {
	name: string;
	folder: string;
	examDate: string | null;
	daysToExam: number | null;
	sprint: boolean;
	total: number;
	suspended: number;
	dueCount: number;
	overdueCount: number;
	stageCounts: number[];
	// 平均定着度（0〜1）。ステージの平均を進捗バーにするためだけの値。
	retention: number;
	configured: boolean;
}

export function summarizeDecks(
	notes: StudyNote[],
	options: QueueOptions,
	todayISO: string,
): DeckSummary[] {
	const byDeck = new Map<string, StudyNote[]>();
	for (const deck of options.decks) byDeck.set(deck.name, []);
	for (const note of notes) {
		const list = byDeck.get(note.deck);
		if (list) list.push(note);
		else byDeck.set(note.deck, [note]);
	}

	const stageSlots = Math.max(options.intervals.length, 1);

	return [...byDeck.entries()].map(([name, deckNotes]) => {
		const config = findDeck(name, options.decks);
		const active = deckNotes.filter((note) => !note.suspended);
		const stageCounts = new Array<number>(stageSlots).fill(0);
		let retentionSum = 0;
		for (const note of active) {
			const slot = Math.min(note.stage, stageSlots - 1);
			stageCounts[slot] = (stageCounts[slot] ?? 0) + 1;
			retentionSum += retentionRatio(note.stage, options.intervals);
		}
		const overdueCount = active.filter(
			(note) => note.nextDate !== null && note.nextDate < todayISO,
		).length;
		const dueCount = active.filter(
			(note) => note.nextDate === null || note.nextDate <= todayISO,
		).length;

		return {
			name,
			folder: config?.folder ?? '',
			examDate: config?.examDate ?? null,
			daysToExam: daysToExam(config?.examDate ?? null, todayISO),
			sprint: isSprintDeck(config, todayISO, options.finalSprintDays),
			total: deckNotes.length,
			suspended: deckNotes.length - active.length,
			dueCount,
			overdueCount,
			stageCounts,
			retention: active.length > 0 ? retentionSum / active.length : 0,
			configured: config !== null,
		};
	}).sort((a, b) => {
		// 試験が近いデッキを上に出す。試験日なしは末尾。
		const aDays = a.daysToExam ?? Number.MAX_SAFE_INTEGER;
		const bDays = b.daysToExam ?? Number.MAX_SAFE_INTEGER;
		if (aDays !== bDays) return aDays - bDays;
		return a.name.localeCompare(b.name, 'ja');
	});
}
