import { describe, expect, it } from 'vitest';
import { QueueOptions, buildQueue } from '../src/studyCurve/reviewQueue';
import { postponeTarget } from '../src/studyCurve/schedule';
import { PostponeInSprintError, applyPostpone } from '../src/studyCurve/studyMutator';
import type { DeckConfig, StudyNote } from '../src/studyCurve/types';

const TODAY = '2026-09-28';

describe('postponeTarget', () => {
	it.each<[string, string | null, string, string]>([
		['2026-09-28', '2026-09-28', '2026-09-29', '今日が予定日'],
		['2026-09-28', '2026-09-27', '2026-09-29', '1日遅れ'],
		['2026-09-28', '2026-09-23', '2026-09-29', '5日遅れ'],
		['2026-09-28', '2026-10-01', '2026-10-02', '未来の予定日（直前総ざらいの前倒し分）'],
		['2026-09-28', null, '2026-09-29', '予定日なし'],
		['2026-09-30', '2026-09-25', '2026-10-01', '月をまたぐ'],
		['2026-12-31', null, '2027-01-01', '年をまたぐ'],
		['2028-02-28', '2028-02-20', '2028-02-29', 'うるう年'],
	])('今日 %s・予定日 %s → %s（%s）', (today, nextDate, expected) => {
		expect(postponeTarget(nextDate, today)).toBe(expected);
	});
});

describe('applyPostpone', () => {
	const NOT_SPRINT = () => false;

	it('遅れているノートは明日にし、stage と履歴は変えない', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-next': '2026-09-23',
			'study-stage': 2,
			'study-history': ['2026-09-16 ok'],
		};
		expect(applyPostpone(fm, TODAY, NOT_SPRINT)).toBe('2026-09-29');
		expect(fm).toEqual({
			'study-deck': 'A',
			'study-next': '2026-09-29',
			'study-stage': 2,
			'study-history': ['2026-09-16 ok'],
		});
	});

	it('study-next が不正な形式なら未設定として扱い、明日を正しい形式で書く', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-next': '2026/10/01' };
		expect(applyPostpone(fm, TODAY, NOT_SPRINT)).toBe('2026-09-29');
		expect(fm['study-next']).toBe('2026-09-29');
	});

	it('study-next がなければ明日にする', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A' };
		expect(applyPostpone(fm, TODAY, NOT_SPRINT)).toBe('2026-09-29');
		expect(fm['study-next']).toBe('2026-09-29');
	});

	it('study-deck がなければ例外を投げ、study-next を変えない', () => {
		const fm: Record<string, unknown> = { 'study-next': '2026-09-23' };
		expect(() => applyPostpone(fm, TODAY, NOT_SPRINT)).toThrow('このノートは復習対象ではありません');
		expect(fm).toEqual({ 'study-next': '2026-09-23' });
	});

	it('frontmatter の最新のデッキが直前総ざらい中なら例外を投げ、study-next を変えない', () => {
		const fm: Record<string, unknown> = { 'study-deck': ' E ', 'study-next': '2026-09-23' };
		const asked: string[] = [];
		const inSprint = (deck: string) => {
			asked.push(deck);
			return deck === 'E';
		};
		expect(() => applyPostpone(fm, TODAY, inSprint)).toThrow(PostponeInSprintError);
		expect(asked).toEqual(['E']);
		expect(fm).toEqual({ 'study-deck': ' E ', 'study-next': '2026-09-23' });
	});
});

describe('buildQueue の inSprint', () => {
	function note(basename: string, deck: string, nextDate: string | null): StudyNote {
		return {
			filePath: `${deck}/${basename}.md`,
			basename,
			deck,
			stage: 0,
			nextDate,
			history: [],
			suspended: false,
		};
	}

	/** デッキ A の試験日を examDate にした設定（直前総ざらい 7日） */
	function options(examDate: string | null, dailyLimit = 0): QueueOptions {
		const decks: DeckConfig[] = [{ name: 'A', folder: 'A', examDate }];
		return { decks, intervals: [1, 3, 7], finalSprintDays: 7, dailyLimit };
	}

	function single(examDate: string | null, nextDate: string | null, deck = 'A') {
		return buildQueue([note('n', deck, nextDate)], options(examDate), TODAY);
	}

	it('直前総ざらい中（あと3日）の遅延は一覧に出て、inSprint が true', () => {
		const queue = single('2026-10-01', '2026-09-25');
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({ reason: 'overdue', inSprint: true });
	});

	it('直前総ざらい中の今日の予定は inSprint が true', () => {
		expect(single('2026-10-01', '2026-09-28')[0]).toMatchObject({ reason: 'due', inSprint: true });
	});

	it('直前総ざらい中の未来の予定は前倒しで出て、inSprint が true', () => {
		expect(single('2026-10-01', '2026-09-30')[0]).toMatchObject({
			reason: 'sprint',
			inSprint: true,
		});
	});

	it('直前総ざらい中の予定日なしは今日として出て、inSprint が true', () => {
		expect(single('2026-10-01', null)[0]).toMatchObject({ reason: 'due', inSprint: true });
	});

	it('試験日なしの遅延は inSprint が false', () => {
		expect(single(null, '2026-09-25')[0]).toMatchObject({ reason: 'overdue', inSprint: false });
	});

	it('試験日なしの未来の予定は一覧に出ない', () => {
		expect(single(null, '2026-09-30')).toHaveLength(0);
	});

	it('試験日を過ぎたデッキは inSprint が false', () => {
		expect(single('2026-09-20', '2026-09-25')[0]).toMatchObject({ inSprint: false });
	});

	it('試験当日は直前総ざらいの期間中', () => {
		expect(single('2026-09-28', '2026-09-30')[0]).toMatchObject({
			reason: 'sprint',
			inSprint: true,
		});
	});

	it('試験まであと7日（境界）は期間中', () => {
		expect(single('2026-10-05', '2026-09-28')[0]).toMatchObject({ inSprint: true });
	});

	it('試験まであと8日は期間外', () => {
		expect(single('2026-10-06', '2026-09-28')[0]).toMatchObject({ inSprint: false });
	});

	it('設定にないデッキ名は inSprint が false', () => {
		expect(single('2026-10-01', '2026-09-25', 'unknown')[0]).toMatchObject({ inSprint: false });
	});

	it('1日の上限で切っても inSprint は保たれる', () => {
		const queue = buildQueue(
			[note('x', 'A', '2026-09-25'), note('y', 'A', '2026-09-26')],
			options('2026-10-01', 1),
			TODAY,
		);
		expect(queue).toHaveLength(1);
		expect(queue[0]).toMatchObject({ reason: 'overdue', inSprint: true });
	});
});
