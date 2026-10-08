import { describe, expect, it } from 'vitest';
import { forecast } from '../src/studyCurve/reviewQueue';
import type { StudyNote } from '../src/studyCurve/types';

// 予定グラフの件数と、今日に数えた遅れの件数（#90）

const TODAY = '2026-10-08';

function note(name: string, nextDate: string | null, suspended = false): StudyNote {
	return {
		filePath: `Queue/${name}.md`,
		basename: name,
		deck: 'Queue',
		stage: 1,
		nextDate,
		history: [],
		suspended,
	};
}

describe('forecast', () => {
	it('1. 予定日を過ぎたノートは今日に数え、遅れの件数にも数える', () => {
		const days = forecast(
			[note('today', TODAY), note('overdue-1', '2026-10-07'), note('overdue-5', '2026-10-03')],
			TODAY,
			3,
		);
		expect(days[0]).toEqual({ date: TODAY, count: 3, overdue: 2 });
	});

	it('2. 遅れがなければ、今日の遅れの件数は 0', () => {
		expect(forecast([note('today', TODAY)], TODAY, 1)).toEqual([{ date: TODAY, count: 1, overdue: 0 }]);
	});

	it('3. 今日以外の日は、遅れの件数がいつも 0', () => {
		const days = forecast([note('overdue', '2026-10-01'), note('later', '2026-10-10')], TODAY, 4);
		expect(days).toEqual([
			{ date: '2026-10-08', count: 1, overdue: 1 },
			{ date: '2026-10-09', count: 0, overdue: 0 },
			{ date: '2026-10-10', count: 1, overdue: 0 },
			{ date: '2026-10-11', count: 0, overdue: 0 },
		]);
	});

	it('4. 休止中と予定日のないノートは、件数にも遅れにも数えない（今までどおり）', () => {
		const days = forecast([note('suspended', '2026-10-01', true), note('no-next', null)], TODAY, 1);
		expect(days).toEqual([{ date: TODAY, count: 0, overdue: 0 }]);
	});

	it('5. 期間より後の予定は数えない（今までどおり）', () => {
		const days = forecast([note('far', '2026-10-20')], TODAY, 3);
		expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(0);
	});
});
