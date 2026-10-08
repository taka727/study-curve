import { describe, expect, it } from 'vitest';
import { applyDeckRename, applyUnenroll } from '../src/studyCurve/studyMutator';

// 設計書 §6.1 の表（#22 の完了条件3・6）

describe('applyDeckRename', () => {
	it('1. study-deck だけを書き換え、ほかのキーは変えない', () => {
		const fm: Record<string, unknown> = {
			'study-deck': 'A',
			'study-stage': 3,
			'study-next': '2026-10-10',
			'study-history': ['2026-10-01 ok'],
			tags: ['x'],
		};
		expect(applyDeckRename(fm, 'A', 'B')).toBe(true);
		expect(fm).toEqual({
			'study-deck': 'B',
			'study-stage': 3,
			'study-next': '2026-10-10',
			'study-history': ['2026-10-01 ok'],
			tags: ['x'],
		});
	});

	it('2. 前後の空白は無視して比べる', () => {
		const fm: Record<string, unknown> = { 'study-deck': ' A ' };
		expect(applyDeckRename(fm, 'A', 'B')).toBe(true);
		expect(fm['study-deck']).toBe('B');
	});

	it('3. ほかのデッキなら変えない', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'C' };
		expect(applyDeckRename(fm, 'A', 'B')).toBe(false);
		expect(fm).toEqual({ 'study-deck': 'C' });
	});

	it('4. 大文字と小文字は区別する', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'a' };
		expect(applyDeckRename(fm, 'A', 'B')).toBe(false);
		expect(fm['study-deck']).toBe('a');
	});

	it('5. study-deck がない、文字列でないなら変えない', () => {
		const none: Record<string, unknown> = {};
		const numeric: Record<string, unknown> = { 'study-deck': 1 };
		expect(applyDeckRename(none, 'A', 'B')).toBe(false);
		expect(applyDeckRename(numeric, 'A', 'B')).toBe(false);
		expect(none).toEqual({});
		expect(numeric).toEqual({ 'study-deck': 1 });
	});

	it('6. 休止中のノートも書き換え、休止はそのまま', () => {
		const fm: Record<string, unknown> = { 'study-deck': 'A', 'study-suspended': true };
		expect(applyDeckRename(fm, 'A', 'B')).toBe(true);
		expect(fm).toEqual({ 'study-deck': 'B', 'study-suspended': true });
	});
});

// 設計書 §6.1 の表（#25 の完了条件3・5）

describe('applyUnenroll', () => {
	function enrolledFm(deck: string): Record<string, unknown> {
		return {
			title: 't',
			tags: ['x'],
			'study-deck': deck,
			'study-stage': 3,
			'study-next': '2026-10-10',
			'study-history': ['2026-10-01 ok'],
			'study-suspended': true,
		};
	}

	it('1. study-* の5つを消し、ほかのキーは残す', () => {
		const fm = enrolledFm('A');
		expect(applyUnenroll(fm)).toBe(true);
		expect(fm).toEqual({ title: 't', tags: ['x'] });
	});

	it('2. onlyDeck と同じデッキなら消す', () => {
		const fm = enrolledFm('A');
		expect(applyUnenroll(fm, { onlyDeck: 'A' })).toBe(true);
		expect(fm).toEqual({ title: 't', tags: ['x'] });
	});

	it('3. 前後の空白は無視して比べる', () => {
		expect(applyUnenroll(enrolledFm(' A '), { onlyDeck: 'A' })).toBe(true);
	});

	it('4. ほかのデッキなら何も変えない', () => {
		const fm = enrolledFm('B');
		expect(applyUnenroll(fm, { onlyDeck: 'A' })).toBe(false);
		expect(fm).toEqual(enrolledFm('B'));
	});

	it('5. study-deck がなければ何も変えない', () => {
		const fm: Record<string, unknown> = { title: 't' };
		expect(applyUnenroll(fm, { onlyDeck: 'A' })).toBe(false);
		expect(fm).toEqual({ title: 't' });
	});

	it('6. 大文字と小文字は区別する', () => {
		expect(applyUnenroll(enrolledFm('a'), { onlyDeck: 'A' })).toBe(false);
	});
});
