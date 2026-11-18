import { describe, expect, it } from 'vitest';
import {
	countNotesByDeck,
	parseNextDate,
	parseSuspended,
	studyNoteFromFrontmatter,
} from '../src/studyCurve/studyIndex';

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

// frontmatter の値の型の揺れ（#9）
describe('parseNextDate', () => {
	it('YYYY-MM-DD はそのまま', () => {
		expect(parseNextDate('2026-09-26')).toBe('2026-09-26');
		expect(parseNextDate(' 2026-09-26 ')).toBe('2026-09-26');
	});

	it('時刻が付いていたら日付の部分を読む', () => {
		expect(parseNextDate('2026-09-26T10:00')).toBe('2026-09-26');
		expect(parseNextDate('2026-09-26T10:00:00')).toBe('2026-09-26');
		expect(parseNextDate('2026-09-26 9:30')).toBe('2026-09-26');
		expect(parseNextDate('2026-09-26T23:30:00+09:00')).toBe('2026-09-26');
	});

	it('日付として読めなければ null', () => {
		expect(parseNextDate(undefined)).toBeNull();
		expect(parseNextDate('')).toBeNull();
		expect(parseNextDate('2026/09/26')).toBeNull();
		expect(parseNextDate('2026-09-26x')).toBeNull();
		expect(parseNextDate('2026-09-26T')).toBeNull();
		expect(parseNextDate(20260926)).toBeNull();
	});
});

describe('parseSuspended', () => {
	it('真偽値の true と、文字列の "true" は休止', () => {
		expect(parseSuspended(true)).toBe(true);
		expect(parseSuspended('true')).toBe(true);
		expect(parseSuspended(' TRUE ')).toBe(true);
	});

	it('それ以外は休止でない', () => {
		expect(parseSuspended(false)).toBe(false);
		expect(parseSuspended('false')).toBe(false);
		expect(parseSuspended(undefined)).toBe(false);
		expect(parseSuspended('')).toBe(false);
		expect(parseSuspended('yes')).toBe(false);
		expect(parseSuspended(1)).toBe(false);
	});
});

describe('studyNoteFromFrontmatter', () => {
	it('文字列で保存された値も読む', () => {
		const note = studyNoteFromFrontmatter('A/n.md', 'n', {
			'study-deck': 'A',
			'study-stage': '3',
			'study-next': '2026-09-26T10:00',
			'study-suspended': 'true',
		});
		expect(note).toMatchObject({ stage: 3, nextDate: '2026-09-26', suspended: true });
	});

	it('数値・日付・真偽値で保存された値は今までどおり読む', () => {
		const note = studyNoteFromFrontmatter('A/n.md', 'n', {
			'study-deck': 'A',
			'study-stage': 2,
			'study-next': '2026-09-26',
			'study-suspended': false,
		});
		expect(note).toMatchObject({ stage: 2, nextDate: '2026-09-26', suspended: false });
	});
});
