import { describe, expect, it } from 'vitest';
import { formatHistoryEntry, parseHistoryEntry } from '../src/studyCurve/studyIndex';
import { Grade } from '../src/studyCurve/types';

// study-history の1行の読み書き（#8）

describe('parseHistoryEntry', () => {
	it('日付と評価を読む', () => {
		expect(parseHistoryEntry('2026-09-12 ok')).toEqual({ date: '2026-09-12', grade: 'good' });
		expect(parseHistoryEntry('2026-09-12 hard')).toEqual({ date: '2026-09-12', grade: 'hard' });
		expect(parseHistoryEntry('2026-09-12 ng')).toEqual({ date: '2026-09-12', grade: 'again' });
		expect(parseHistoryEntry('2026-09-12 new')).toEqual({ date: '2026-09-12', grade: 'fresh' });
	});

	it('内部の名前（again・good・fresh）でも読む', () => {
		expect(parseHistoryEntry('2026-09-12 again')?.grade).toBe('again');
		expect(parseHistoryEntry('2026-09-12 good')?.grade).toBe('good');
		expect(parseHistoryEntry('2026-09-12 fresh')?.grade).toBe('fresh');
	});

	it('評価の大文字小文字は問わない', () => {
		expect(parseHistoryEntry('2026-09-12 OK')?.grade).toBe('good');
		expect(parseHistoryEntry('2026-09-12 Ng')?.grade).toBe('again');
	});

	it('評価がない、または知らない評価なら ◯（good）として読む', () => {
		expect(parseHistoryEntry('2026-09-12')).toEqual({ date: '2026-09-12', grade: 'good' });
		expect(parseHistoryEntry('2026-09-12 maybe')?.grade).toBe('good');
	});

	it('前後の空白と、評価のあとの余計な語は無視する', () => {
		expect(parseHistoryEntry('  2026-09-12   hard  ')).toEqual({ date: '2026-09-12', grade: 'hard' });
		expect(parseHistoryEntry('2026-09-12 ng メモ')?.grade).toBe('again');
	});

	it('日付で始まらなければ読まない', () => {
		expect(parseHistoryEntry('ok 2026-09-12')).toBeNull();
		expect(parseHistoryEntry('2026/09/12 ok')).toBeNull();
		expect(parseHistoryEntry('')).toBeNull();
		expect(parseHistoryEntry(20260912)).toBeNull();
		expect(parseHistoryEntry(null)).toBeNull();
	});
});

describe('formatHistoryEntry', () => {
	it('評価を frontmatter の語で書く', () => {
		expect(formatHistoryEntry({ date: '2026-09-12', grade: 'good' })).toBe('2026-09-12 ok');
		expect(formatHistoryEntry({ date: '2026-09-12', grade: 'again' })).toBe('2026-09-12 ng');
	});

	it('書いたものを読むと元に戻る', () => {
		const grades: Grade[] = ['good', 'hard', 'again', 'fresh'];
		for (const grade of grades) {
			const entry = { date: '2026-09-12', grade };
			expect(parseHistoryEntry(formatHistoryEntry(entry))).toEqual(entry);
		}
	});
});
