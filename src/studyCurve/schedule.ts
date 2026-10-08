import { addDays, daysBetween } from './dateUtils';
import { Grade } from './types';

// エビングハウスの忘却曲線でよく使われる復習タイミング（日数）。
// stage 0 の項目は「初回学習の翌日」に出る。最終ステージに達した後は
// 配列の最後の間隔をそのまま繰り返す（無限に間隔を伸ばさない）。
export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30, 60, 90];

// 初見（☆）で回すときの間隔。ステージに関係なくこの日数で固定する。
// 翌日（stage 0 の間隔）だと「読んだ直後の短期記憶」を測ってしまい、
// 逆に1週間空けると初学の内容はほぼ残らない。その間を取っている。
export const FRESH_INTERVAL_DAYS = 3;

export function parseIntervals(raw: string): number[] {
	const parsed = raw
		.split(',')
		.map((part) => Number.parseInt(part.trim(), 10))
		.filter((n) => Number.isFinite(n) && n > 0);
	return parsed.length > 0 ? parsed : DEFAULT_INTERVALS;
}

export function formatIntervals(intervals: number[]): string {
	return intervals.join(', ');
}

export function intervalForStage(stage: number, intervals: number[]): number {
	const list = intervals.length > 0 ? intervals : DEFAULT_INTERVALS;
	const index = Math.min(Math.max(stage, 0), list.length - 1);
	return list[index] ?? 1;
}

// ◯ でステージを1つ進め、△ は据え置き（同じ間隔でもう一度）、✗ は 0 に戻す。
// ☆（初見）も据え置き。まだ保持を測れていないので、進めるのも戻すのも根拠がない。
// SM-2 のような ease factor は持たない。手応えとステージの対応が一目で分かる方が、
// 「なぜ今日これが出たのか」を納得しながら続けられるため。
export function nextStage(stage: number, grade: Grade, maxStage: number): number {
	if (grade === 'again') return 0;
	if (grade === 'hard' || grade === 'fresh') return Math.min(Math.max(stage, 0), maxStage);
	return Math.min(Math.max(stage, 0) + 1, maxStage);
}

export interface ScheduleResult {
	stage: number;
	nextDate: string;
	// 試験日を越える予定だったので手前に寄せた場合に true
	clampedByExam: boolean;
}

// 復習1回分のスケジューリング。試験日が設定されていて、次回予定が試験日を
// 越えてしまう場合は試験日当日まで前倒しする（試験後に初めて復習するのでは
// 意味がないため）。試験日を過ぎているデッキでは前倒ししない。
export function scheduleReview(
	currentStage: number,
	grade: Grade,
	intervals: number[],
	todayISO: string,
	examDate: string | null,
): ScheduleResult {
	const list = intervals.length > 0 ? intervals : DEFAULT_INTERVALS;
	const stage = nextStage(currentStage, grade, list.length - 1);
	// 初見はステージの間隔を使わず固定日数で回す。ステージ0のまま翌日に戻すと
	// 「まだ習っていない」項目が毎日キューに出続けてカーブが進まないため。
	const days = grade === 'fresh' ? FRESH_INTERVAL_DAYS : intervalForStage(stage, list);
	const plain = addDays(todayISO, days);

	if (examDate && daysBetween(todayISO, examDate) > 0 && plain > examDate) {
		return { stage, nextDate: examDate, clampedByExam: true };
	}
	return { stage, nextDate: plain, clampedByExam: false };
}

/**
 * 「明日に送る」の新しい予定日。予定日と今日のうち遅いほうの翌日を返す。
 * 遅れているノートを「予定日 + 1日」にすると、まだ過去の日付のままで
 * 今日の一覧から消えないため、今日より前の予定日は今日として扱う。
 * 日付は YYYY-MM-DD の文字列なので、文字列の大小で前後を比べられる。
 * @param nextDate 今の予定日（YYYY-MM-DD）。未設定なら null
 * @param today 今日（YYYY-MM-DD）
 */
export function postponeTarget(nextDate: string | null, today: string): string {
	const base = nextDate !== null && nextDate > today ? nextDate : today;
	return addDays(base, 1);
}

// 新規登録時の初回復習日。学習した当日に登録する前提なので stage 0 の間隔（既定1日）を足す。
export function initialNextDate(
	intervals: number[],
	todayISO: string,
	examDate: string | null,
): string {
	const plain = addDays(todayISO, intervalForStage(0, intervals));
	if (examDate && daysBetween(todayISO, examDate) > 0 && plain > examDate) {
		return examDate;
	}
	return plain;
}

// 定着度の目安（0〜1）。ステージが最終段に近いほど1に寄る。
// 進捗バーの表示だけに使う値で、スケジューリングには影響しない。
export function retentionRatio(stage: number, intervals: number[]): number {
	const list = intervals.length > 0 ? intervals : DEFAULT_INTERVALS;
	const max = Math.max(list.length - 1, 1);
	return Math.min(Math.max(stage, 0), max) / max;
}
