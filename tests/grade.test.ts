import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERVALS } from '../src/studyCurve/schedule';
import { parseStage } from '../src/studyCurve/studyIndex';
import { HISTORY_LIMIT, applyGrade } from '../src/studyCurve/studyMutator';

const TODAY = '2026-09-28';
const noExam = (): string | null => null;

describe('parseStage', () => {
	it('数値は切り捨て、負は 0', () => {
		expect(parseStage(3)).toBe(3);
		expect(parseStage(2.7)).toBe(2);
		expect(parseStage(-1)).toBe(0);
	});

	it('数値でなければ 0（文字列の "3" への対応は #32 で行う）', () => {
		expect(parseStage('3')).toBe(0);
		expect(parseStage(undefined)).toBe(0);
		expect(parseStage(NaN)).toBe(0);
	});
});

describe('applyGrade', () => {
	it('good でステージを1つ進め、次回日と履歴を書く', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 0,
			'study-history': [],
		};
		const result = applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam);
		expect(result).toEqual({ stage: 1, nextDate: '2026-10-01', clampedByExam: false });
		expect(fm['study-stage']).toBe(1);
		expect(fm['study-next']).toBe('2026-10-01');
		expect(fm['study-history']).toEqual(['2026-09-28 ok']);
	});

	it('同じオブジェクトに2回呼べば2回分記録する（二重実行を防ぐのは StudyActions の責務）', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 0,
			'study-history': [],
		};
		applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam);
		const second = applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam);
		expect(second.stage).toBe(2);
		expect(fm['study-stage']).toBe(2);
		expect(fm['study-history']).toEqual(['2026-09-28 ok', '2026-09-28 ok']);
	});

	it('study-history がなければ作る', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-stage': 0 };
		applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam);
		expect(fm['study-history']).toEqual(['2026-09-28 ok']);
	});

	it('履歴は直近の上限件数だけ残す', () => {
		const old = Array.from(
			{ length: HISTORY_LIMIT },
			(_, i) => `2026-01-${String(i + 1).padStart(2, '0')} ok`,
		);
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 0,
			'study-history': [...old],
		};
		applyGrade(fm, 'hard', TODAY, DEFAULT_INTERVALS, noExam);
		const history = fm['study-history'] as string[];
		expect(HISTORY_LIMIT).toBe(20);
		expect(history).toHaveLength(20);
		expect(history[0]).toBe(old[1]);
		expect(history[19]).toBe('2026-09-28 hard');
	});

	it('履歴に数値が混ざっていたら文字列にして残す', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 0,
			'study-history': [20260101],
		};
		applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam);
		expect(fm['study-history']).toEqual(['20260101', '2026-09-28 ok']);
	});

	it.each([
		['study-deck がない', {}],
		['study-deck が空文字', { 'study-deck': '' }],
		['study-deck が空白だけ', { 'study-deck': '  ' }],
	])('%s なら例外を投げ、fm を変えない', (_label, extra) => {
		const fm: Record<string, unknown> = {
			'study-stage': 2,
			'study-next': '2026-09-28',
			'study-history': ['2026-09-20 ok'],
			...extra,
		};
		const before = structuredClone(fm);
		expect(() => applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, noExam)).toThrow(
			'このノートは復習対象ではありません',
		);
		expect(fm).toEqual(before);
	});

	it('試験日は frontmatter のデッキ名で引き、近ければ前倒しする', () => {
		const fm: Record<string, unknown> = {
			'study-deck': ' A ',
			'study-stage': 3,
			'study-history': [],
		};
		const asked: string[] = [];
		const result = applyGrade(fm, 'good', TODAY, DEFAULT_INTERVALS, (deck) => {
			asked.push(deck);
			return deck === 'A' ? '2026-10-10' : null;
		});
		expect(asked).toEqual(['A']);
		expect(result).toEqual({ stage: 4, nextDate: '2026-10-10', clampedByExam: true });
		expect(fm['study-next']).toBe('2026-10-10');
	});

	it('fresh は履歴の末尾に new を書く', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 2,
			'study-history': ['2026-09-20 ok'],
		};
		applyGrade(fm, 'fresh', TODAY, DEFAULT_INTERVALS, noExam);
		expect(fm['study-history']).toEqual(['2026-09-20 ok', '2026-09-28 new']);
		expect(fm['study-stage']).toBe(2);
	});

	it('study-* 以外のキーは変えない', () => {
		const fm: Record<string, unknown> = {
			title: 'VPC',
			tags: ['aws', 'network'],
			'study-deck': 'A',
			'study-stage': 1,
			'study-suspended': false,
		};
		applyGrade(fm, 'again', TODAY, DEFAULT_INTERVALS, noExam);
		expect(fm['title']).toBe('VPC');
		expect(fm['tags']).toEqual(['aws', 'network']);
		expect(fm['study-deck']).toBe('A');
		expect(fm['study-suspended']).toBe(false);
		expect(fm['study-stage']).toBe(0);
		expect(fm['study-next']).toBe('2026-09-29');
	});
});
