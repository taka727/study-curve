import { describe, expect, it } from 'vitest';
import { DEFAULT_INTERVALS } from '../src/studyCurve/schedule';
import {
	GradeUndo,
	UndoConflictError,
	applyGrade,
	applyUndoGrade,
	gradeFields,
} from '../src/studyCurve/studyMutator';
import { Grade } from '../src/studyCurve/types';

// 採点の取り消し（#5）

const TODAY = '2026-09-28';

/** fm を採点し、取り消しに使う前と後の値を返す（StudyActions が processFrontMatter の前後で写し取るのと同じ） */
function grade(fm: Record<string, unknown>, value: Grade): GradeUndo {
	const before = gradeFields(structuredClone(fm));
	applyGrade(fm, value, TODAY, DEFAULT_INTERVALS, () => null);
	return { before, after: gradeFields(structuredClone(fm)) };
}

describe('applyUndoGrade', () => {
	it('ステージ・次回日・履歴を採点の前の値に戻し、ほかのキーには触れない', () => {
		const original = {
			'study-deck': 'A',
			'study-stage': 3,
			'study-next': '2026-09-26',
			'study-history': ['2026-09-12 ok'],
			'study-suspended': true,
			tags: ['aws'],
		};
		const fm: Record<string, unknown> = structuredClone(original);
		const undo = grade(fm, 'again');
		expect(fm['study-stage']).toBe(0);
		applyUndoGrade(fm, undo);
		expect(fm).toEqual(original);
	});

	it('採点の前になかったキーは消す', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A' };
		const undo = grade(fm, 'good');
		applyUndoGrade(fm, undo);
		expect(fm).toEqual({ 'study-deck': 'A' });
	});

	it('採点のあとに変わっていたら UndoConflictError を投げ、fm を変えない', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-stage': 1 };
		const undo = grade(fm, 'good');
		grade(fm, 'good');
		const snapshot = structuredClone(fm);
		expect(() => applyUndoGrade(fm, undo)).toThrow(UndoConflictError);
		expect(fm).toEqual(snapshot);
	});

	it('次回日だけ手で変えていても取り消さない', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-stage': 1 };
		const undo = grade(fm, 'good');
		fm['study-next'] = '2026-12-01';
		expect(() => applyUndoGrade(fm, undo)).toThrow(UndoConflictError);
		expect(fm['study-next']).toBe('2026-12-01');
	});

	it('復習対象から外されていたら取り消さない', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A' };
		const undo = grade(fm, 'good');
		delete fm['study-deck'];
		expect(() => applyUndoGrade(fm, undo)).toThrow(UndoConflictError);
	});

	it('休止の切り替えやデッキの名前の変更のあとでも、3つのキーが同じなら取り消す', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-stage': 2 };
		const undo = grade(fm, 'good');
		fm['study-suspended'] = true;
		fm['study-deck'] = 'B';
		applyUndoGrade(fm, undo);
		expect(fm).toEqual({ 'study-deck': 'B', 'study-stage': 2, 'study-suspended': true });
	});
});
