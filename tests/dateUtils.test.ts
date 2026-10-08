import { describe, expect, it } from 'vitest';
import { isCalendarDate } from '../src/studyCurve/dateUtils';

// 設計書 §6.1 の表（#9）

describe('isCalendarDate', () => {
	it('26. うるう年の 2/29 は実在する', () => {
		expect(isCalendarDate('2028-02-29')).toBe(true);
	});

	it('27. うるう年でない年の 2/29 は実在しない', () => {
		expect(isCalendarDate('2026-02-29')).toBe(false);
	});

	it('28. 13月は実在しない', () => {
		expect(isCalendarDate('2026-13-01')).toBe(false);
		expect(isCalendarDate('2026-00-10')).toBe(false);
		expect(isCalendarDate('2026-04-31')).toBe(false);
	});

	it('29. 形が違う', () => {
		expect(isCalendarDate('2026-1-5')).toBe(false);
		expect(isCalendarDate(' 2026-01-05')).toBe(false);
	});

	it('30. 文字列でない', () => {
		expect(isCalendarDate(null)).toBe(false);
		expect(isCalendarDate(20261025)).toBe(false);
		expect(isCalendarDate(undefined)).toBe(false);
	});

	it('ふつうの日付', () => {
		expect(isCalendarDate('2026-12-31')).toBe(true);
		expect(isCalendarDate('2026-01-01')).toBe(true);
	});
});
