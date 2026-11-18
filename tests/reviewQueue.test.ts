import { describe, expect, it } from 'vitest';
import {
	QueueOptions,
	buildQueue,
	daysToExam,
	isSprintDeck,
	summarizeDecks,
} from '../src/studyCurve/reviewQueue';
import { DeckConfig, StudyNote } from '../src/studyCurve/types';

// 今日の復習の並び、試験日までの日数、直前総ざらいの判定、デッキごとの集計（#8）

const TODAY = '2026-09-28';

function note(
	basename: string,
	overrides: Partial<Omit<StudyNote, 'basename'>> = {},
): StudyNote {
	const deck = overrides.deck ?? 'A';
	return {
		filePath: `${deck}/${basename}.md`,
		basename,
		deck,
		stage: 0,
		nextDate: TODAY,
		history: [],
		suspended: false,
		...overrides,
	};
}

function options(decks: DeckConfig[], overrides: Partial<QueueOptions> = {}): QueueOptions {
	return { decks, intervals: [1, 3, 7], finalSprintDays: 7, dailyLimit: 0, ...overrides };
}

const DECK_A: DeckConfig = { name: 'A', folder: 'A', examDate: null };

describe('daysToExam', () => {
	it('試験日がなければ null', () => {
		expect(daysToExam(null, TODAY)).toBeNull();
	});

	it('試験日までの日数。当日は 0、過ぎていれば負', () => {
		expect(daysToExam('2026-10-01', TODAY)).toBe(3);
		expect(daysToExam(TODAY, TODAY)).toBe(0);
		expect(daysToExam('2026-09-25', TODAY)).toBe(-3);
	});

	it('月と年をまたぐ', () => {
		expect(daysToExam('2026-11-02', TODAY)).toBe(35);
		expect(daysToExam('2027-01-01', '2026-12-31')).toBe(1);
	});
});

describe('isSprintDeck', () => {
	const deck = (examDate: string | null): DeckConfig => ({ name: 'A', folder: 'A', examDate });

	it('デッキが設定にない、または試験日がなければ false', () => {
		expect(isSprintDeck(null, TODAY, 7)).toBe(false);
		expect(isSprintDeck(deck(null), TODAY, 7)).toBe(false);
	});

	it('試験当日から finalSprintDays 日前までが期間中', () => {
		expect(isSprintDeck(deck(TODAY), TODAY, 7)).toBe(true);
		expect(isSprintDeck(deck('2026-10-05'), TODAY, 7)).toBe(true);
		expect(isSprintDeck(deck('2026-10-06'), TODAY, 7)).toBe(false);
	});

	it('試験日を過ぎたら期間外', () => {
		expect(isSprintDeck(deck('2026-09-27'), TODAY, 7)).toBe(false);
	});

	it('finalSprintDays が 0 なら試験当日だけ', () => {
		expect(isSprintDeck(deck(TODAY), TODAY, 0)).toBe(true);
		expect(isSprintDeck(deck('2026-09-29'), TODAY, 0)).toBe(false);
	});
});

describe('buildQueue の並び', () => {
	const names = (queue: ReturnType<typeof buildQueue>): string[] =>
		queue.map((item) => item.note.basename);

	it('遅れ → 今日 → 直前総ざらいの前倒し の順', () => {
		const decks: DeckConfig[] = [DECK_A, { name: 'S', folder: 'S', examDate: '2026-10-01' }];
		const queue = buildQueue(
			[
				note('前倒し', { deck: 'S', nextDate: '2026-09-30' }),
				note('今日', { nextDate: TODAY }),
				note('遅れ', { nextDate: '2026-09-27' }),
			],
			options(decks),
			TODAY,
		);
		expect(names(queue)).toEqual(['遅れ', '今日', '前倒し']);
		expect(queue.map((item) => item.reason)).toEqual(['overdue', 'due', 'sprint']);
		expect(queue.map((item) => item.overdueDays)).toEqual([1, 0, -2]);
	});

	it('遅れは日数の多い順', () => {
		const queue = buildQueue(
			[
				note('1日', { nextDate: '2026-09-27' }),
				note('5日', { nextDate: '2026-09-23' }),
				note('3日', { nextDate: '2026-09-25' }),
			],
			options([DECK_A]),
			TODAY,
		);
		expect(names(queue)).toEqual(['5日', '3日', '1日']);
	});

	it('直前総ざらいの前倒しは、予定日の近い順', () => {
		const decks: DeckConfig[] = [{ name: 'S', folder: 'S', examDate: '2026-10-05' }];
		const queue = buildQueue(
			[
				note('10/3', { deck: 'S', nextDate: '2026-10-03' }),
				note('9/29', { deck: 'S', nextDate: '2026-09-29' }),
			],
			options(decks),
			TODAY,
		);
		expect(names(queue)).toEqual(['9/29', '10/3']);
	});

	it('同じ遅れならステージの低い順、それも同じなら名前の順', () => {
		const queue = buildQueue(
			[
				note('う', { stage: 2 }),
				note('い', { stage: 0 }),
				note('あ', { stage: 2 }),
			],
			options([DECK_A]),
			TODAY,
		);
		expect(names(queue)).toEqual(['い', 'あ', 'う']);
	});

	it('予定日のないノートは今日の予定と同じ扱い', () => {
		const queue = buildQueue(
			[note('予定あり', { stage: 1 }), note('予定なし', { stage: 0, nextDate: null })],
			options([DECK_A]),
			TODAY,
		);
		expect(names(queue)).toEqual(['予定なし', '予定あり']);
		expect(queue[0]).toMatchObject({ reason: 'due', overdueDays: 0 });
	});

	it('休止中のノートは出さない', () => {
		const queue = buildQueue(
			[note('休止', { nextDate: '2026-09-20', suspended: true }), note('通常')],
			options([DECK_A]),
			TODAY,
		);
		expect(names(queue)).toEqual(['通常']);
	});

	it('設定にないデッキのノートも出すが、直前総ざらいにはならない', () => {
		const queue = buildQueue(
			[note('今日', { deck: '未設定' }), note('未来', { deck: '未設定', nextDate: '2026-09-29' })],
			options([DECK_A]),
			TODAY,
		);
		expect(names(queue)).toEqual(['今日']);
		expect(queue[0]).toMatchObject({ inSprint: false });
	});

	it('1日の上限は並べたあとで切る（遅れの多いものを残す）', () => {
		const notes = [
			note('今日'),
			note('遅れ1', { nextDate: '2026-09-27' }),
			note('遅れ4', { nextDate: '2026-09-24' }),
		];
		expect(names(buildQueue(notes, options([DECK_A], { dailyLimit: 2 }), TODAY))).toEqual([
			'遅れ4',
			'遅れ1',
		]);
	});

	it('1日の上限が 0 なら全件', () => {
		const notes = [note('a'), note('b'), note('c')];
		expect(buildQueue(notes, options([DECK_A], { dailyLimit: 0 }), TODAY)).toHaveLength(3);
	});
});

describe('summarizeDecks', () => {
	it('設定にあってノートのないデッキも、0 件で出す', () => {
		const [summary] = summarizeDecks([], options([DECK_A]), TODAY);
		expect(summary).toEqual({
			name: 'A',
			folder: 'A',
			examDate: null,
			daysToExam: null,
			sprint: false,
			total: 0,
			suspended: 0,
			dueCount: 0,
			overdueCount: 0,
			stageCounts: [0, 0, 0],
			retention: 0,
			configured: true,
		});
	});

	it('設定にないデッキ名のノートも、configured: false のデッキとして出す', () => {
		const summaries = summarizeDecks([note('n', { deck: '未設定' })], options([]), TODAY);
		expect(summaries).toHaveLength(1);
		expect(summaries[0]).toMatchObject({
			name: '未設定',
			folder: '',
			examDate: null,
			total: 1,
			configured: false,
		});
	});

	it('今日の件数は予定日なし・今日・遅れ、遅れの件数は予定日を過ぎたものだけ', () => {
		const [summary] = summarizeDecks(
			[
				note('予定なし', { nextDate: null }),
				note('今日'),
				note('遅れ', { nextDate: '2026-09-20' }),
				note('未来', { nextDate: '2026-10-10' }),
			],
			options([DECK_A]),
			TODAY,
		);
		expect(summary).toMatchObject({ total: 4, dueCount: 3, overdueCount: 1 });
	});

	it('休止中は total と suspended にだけ数え、今日の件数・ステージ・定着度には入れない', () => {
		const [summary] = summarizeDecks(
			[
				note('休止', { stage: 2, nextDate: '2026-09-20', suspended: true }),
				note('通常', { stage: 0 }),
			],
			options([DECK_A]),
			TODAY,
		);
		expect(summary).toMatchObject({
			total: 2,
			suspended: 1,
			dueCount: 1,
			overdueCount: 0,
			stageCounts: [1, 0, 0],
			retention: 0,
		});
	});

	it('ステージの数は間隔の数で区切り、越えたものは最後の段に数える', () => {
		const [summary] = summarizeDecks(
			[note('a', { stage: 0 }), note('b', { stage: 1 }), note('c', { stage: 2 }), note('d', { stage: 9 })],
			options([DECK_A]),
			TODAY,
		);
		expect(summary?.stageCounts).toEqual([1, 1, 2]);
	});

	it('定着度はステージの割合の平均', () => {
		// 間隔 [1, 3, 7] なら、ステージ 0 → 0、1 → 0.5、2 以上 → 1
		const [summary] = summarizeDecks(
			[note('a', { stage: 0 }), note('b', { stage: 1 }), note('c', { stage: 5 })],
			options([DECK_A]),
			TODAY,
		);
		expect(summary?.retention).toBeCloseTo(0.5);
	});

	it('試験日・残り日数・直前総ざらいを設定から出す', () => {
		const decks: DeckConfig[] = [{ name: 'S', folder: 'S', examDate: '2026-10-01' }];
		const [summary] = summarizeDecks([], options(decks), TODAY);
		expect(summary).toMatchObject({ examDate: '2026-10-01', daysToExam: 3, sprint: true });
	});

	it('試験の近い順に並べ、試験日なしは名前の順で末尾', () => {
		const decks: DeckConfig[] = [
			{ name: 'い', folder: 'い', examDate: null },
			{ name: '遠い', folder: '遠い', examDate: '2026-12-01' },
			{ name: 'あ', folder: 'あ', examDate: null },
			{ name: '近い', folder: '近い', examDate: '2026-10-10' },
		];
		const summaries = summarizeDecks([], options(decks), TODAY);
		expect(summaries.map((summary) => summary.name)).toEqual(['近い', '遠い', 'あ', 'い']);
	});
});
