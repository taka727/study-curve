import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, daysBetween } from '../src/studyCurve/dateUtils';
import {
	DEFAULT_INTERVALS,
	initialNextDate,
	intervalForStage,
	nextStage,
	parseIntervals,
	retentionRatio,
	scheduleReview,
} from '../src/studyCurve/schedule';

const TODAY = '2026-09-28';

describe('parseIntervals', () => {
	it('カンマ区切りの数値を読む', () => {
		expect(parseIntervals('1, 3, 7')).toEqual([1, 3, 7]);
	});

	it('空なら既定の間隔', () => {
		expect(parseIntervals('')).toEqual(DEFAULT_INTERVALS);
	});

	it('数値でないもの、0 以下は捨てる', () => {
		expect(parseIntervals('a, 0, -1, 5')).toEqual([5]);
	});
});

describe('intervalForStage', () => {
	it('最終ステージを越えたら末尾の間隔を繰り返す', () => {
		expect(intervalForStage(10, [1, 3, 7])).toBe(7);
	});

	it('負のステージは先頭の間隔', () => {
		expect(intervalForStage(-1, [1, 3, 7])).toBe(1);
	});
});

describe('nextStage', () => {
	it('good で1つ進む', () => {
		expect(nextStage(0, 'good', 6)).toBe(1);
	});

	it('good でも最終ステージで頭打ち', () => {
		expect(nextStage(6, 'good', 6)).toBe(6);
	});

	it('hard は据え置き', () => {
		expect(nextStage(2, 'hard', 6)).toBe(2);
	});

	it('again は 0 に戻す', () => {
		expect(nextStage(4, 'again', 6)).toBe(0);
	});

	it('fresh は据え置き', () => {
		expect(nextStage(3, 'fresh', 6)).toBe(3);
	});

	it('fresh でも負のステージは 0 にする', () => {
		expect(nextStage(-1, 'fresh', 6)).toBe(0);
	});
});

describe('scheduleReview', () => {
	it('stage 0 で good → stage 1、3日後', () => {
		expect(scheduleReview(0, 'good', DEFAULT_INTERVALS, TODAY, null)).toEqual({
			stage: 1,
			nextDate: '2026-10-01',
			clampedByExam: false,
		});
	});

	it('again → stage 0、翌日', () => {
		expect(scheduleReview(3, 'again', DEFAULT_INTERVALS, TODAY, null)).toEqual({
			stage: 0,
			nextDate: '2026-09-29',
			clampedByExam: false,
		});
	});

	it('fresh → ステージ据え置き、3日固定', () => {
		expect(scheduleReview(2, 'fresh', DEFAULT_INTERVALS, TODAY, null)).toEqual({
			stage: 2,
			nextDate: '2026-10-01',
			clampedByExam: false,
		});
	});

	it('hard → ステージ据え置き、そのステージの間隔', () => {
		expect(scheduleReview(2, 'hard', DEFAULT_INTERVALS, TODAY, null)).toEqual({
			stage: 2,
			nextDate: '2026-10-05',
			clampedByExam: false,
		});
	});

	it('試験日を越える予定は試験日に前倒しする', () => {
		expect(scheduleReview(3, 'good', DEFAULT_INTERVALS, TODAY, '2026-10-10')).toEqual({
			stage: 4,
			nextDate: '2026-10-10',
			clampedByExam: true,
		});
	});

	it('予定日と試験日が同じ日なら前倒し扱いにしない', () => {
		expect(scheduleReview(0, 'good', DEFAULT_INTERVALS, TODAY, '2026-10-01')).toEqual({
			stage: 1,
			nextDate: '2026-10-01',
			clampedByExam: false,
		});
	});

	it('試験が今日なら前倒ししない', () => {
		expect(scheduleReview(0, 'good', DEFAULT_INTERVALS, TODAY, TODAY)).toEqual({
			stage: 1,
			nextDate: '2026-10-01',
			clampedByExam: false,
		});
	});

	it('試験が過去なら前倒ししない', () => {
		expect(scheduleReview(0, 'good', DEFAULT_INTERVALS, TODAY, '2026-09-01')).toEqual({
			stage: 1,
			nextDate: '2026-10-01',
			clampedByExam: false,
		});
	});
});

describe('initialNextDate', () => {
	it('試験日がなければ stage 0 の間隔（翌日）', () => {
		expect(initialNextDate(DEFAULT_INTERVALS, TODAY, null)).toBe('2026-09-29');
	});
});

describe('addDays', () => {
	it('年をまたぐ', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('うるう年の 2/29', () => {
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
	});

	it('月をまたぐ', () => {
		expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
	});
});

describe('daysBetween', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('日数の差', () => {
		expect(daysBetween('2026-09-28', '2026-10-01')).toBe(3);
	});

	it('夏時間の開始をまたいでも日数がずれない', () => {
		vi.stubEnv('TZ', 'America/New_York');
		// 2026-03-08 に夏時間が始まり、この2日間は47時間しかない
		expect(new Date('2026-03-09T00:00:00').getTimezoneOffset()).toBe(240);
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
	});
});

describe('retentionRatio', () => {
	it('7段のうち stage 3 は半分', () => {
		expect(retentionRatio(3, [1, 3, 7, 14, 30, 60, 90])).toBe(0.5);
	});
});
