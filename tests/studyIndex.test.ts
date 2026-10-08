import { describe, expect, it } from 'vitest';
import { countNotesByDeck } from '../src/studyCurve/studyIndex';

// 設計書 §6.1 の表（#26）

describe('countNotesByDeck', () => {
	it('17. デッキ名ごとに数える', () => {
		const counts = countNotesByDeck([{ deck: 'A' }, { deck: 'B' }, { deck: 'A' }]);
		expect([...counts]).toEqual([
			['A', 2],
			['B', 1],
		]);
	});

	it('18. 0件なら空', () => {
		expect(countNotesByDeck([]).size).toBe(0);
	});
});
