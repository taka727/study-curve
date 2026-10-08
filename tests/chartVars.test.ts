import { describe, expect, it } from 'vitest';
import { forecastBarVars, forecastOverdueVars, stageSegmentVars } from '../src/studyCurve/chartVars';

// 設計書 §6.1 の表（#7）

const opacity = (vars: Record<string, string>) => vars['--study-curve-stage-opacity'];

describe('stageSegmentVars', () => {
	it('1. 件数と、ステージ0の濃さ（0.25）', () => {
		expect(stageSegmentVars(5, 0, 7)).toEqual({
			'--study-curve-stage-count': '5',
			'--study-curve-stage-opacity': '0.25',
		});
	});

	it('2. 右端のステージは濃さ 1', () => {
		expect(opacity(stageSegmentVars(1, 6, 7))).toBe('1');
	});

	it('3. 間は等分', () => {
		expect(opacity(stageSegmentVars(2, 1, 7))).toBe('0.375');
	});

	it('4. 小数第3位までに丸める', () => {
		expect(opacity(stageSegmentVars(3, 3, 8))).toBe('0.571');
	});

	it('5. 段が1つでも 0 で割らない', () => {
		expect(opacity(stageSegmentVars(4, 0, 1))).toBe('0.25');
	});

	it('6. 大きな件数もそのまま渡す（幅は比で決まる）', () => {
		expect(stageSegmentVars(1200, 2, 7)['--study-curve-stage-count']).toBe('1200');
	});

	it('7. 7段のどの段も、置き換え前の式を丸めた値と同じ', () => {
		for (let index = 0; index < 7; index++) {
			const before = 0.25 + (0.75 * index) / 6;
			expect(Number(opacity(stageSegmentVars(1, index, 7)))).toBeCloseTo(before, 3);
		}
	});
});

describe('forecastBarVars', () => {
	const height = (count: number, max: number) => forecastBarVars(count, max)['--study-curve-bar-height'];

	it('1. 最大の日を 100% とした割合', () => {
		expect(forecastBarVars(42, 100)).toEqual({ '--study-curve-bar-height': '42%' });
	});

	it('2・3. 整数の % に丸める', () => {
		expect(height(1, 3)).toBe('33%');
		expect(height(2, 3)).toBe('67%');
	});

	it('4. 件数0の日は 0%（CSS の min-height で 2px の棒になる）', () => {
		expect(height(0, 5)).toBe('0%');
	});

	it('5. 最大の日は 100%', () => {
		expect(height(5, 5)).toBe('100%');
	});

	it('6. max が 0 でも 0 で割らない', () => {
		expect(height(3, 0)).toBe('0%');
	});

	it('7. max を超えたら 100%（通常は来ない）', () => {
		expect(height(7, 5)).toBe('100%');
	});

	it('8. ごく少ない日は置き換え前と同じく 0%', () => {
		expect(height(1, 1000)).toBe('0%');
	});
});

describe('forecastOverdueVars（#90）', () => {
	const height = (overdue: number, count: number) =>
		forecastOverdueVars(overdue, count)['--study-curve-overdue-height'];

	it('1. 棒の全体（その日の件数）に対する遅れの割合', () => {
		expect(forecastOverdueVars(1, 4)).toEqual({ '--study-curve-overdue-height': '25%' });
	});

	it('2. 整数の % に丸める', () => {
		expect(height(1, 3)).toBe('33%');
		expect(height(2, 3)).toBe('67%');
	});

	it('3. すべて遅れなら 100%', () => {
		expect(height(5, 5)).toBe('100%');
	});

	it('4. 遅れがなければ 0%', () => {
		expect(height(0, 5)).toBe('0%');
	});

	it('5. 遅れが1件でもあれば 1% 以上（丸めで赤が消えない）', () => {
		expect(height(1, 1000)).toBe('1%');
	});

	it('6. 遅れでない分が1件でもあれば 99% 以下（丸めでほかの色が消えない）', () => {
		expect(height(999, 1000)).toBe('99%');
	});

	it('7. 件数が 0 でも 0 で割らない', () => {
		expect(height(0, 0)).toBe('0%');
		expect(height(3, 0)).toBe('0%');
	});
});
