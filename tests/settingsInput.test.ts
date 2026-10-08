import { describe, expect, it } from 'vitest';
import { parseIntervals } from '../src/studyCurve/schedule';
import { parseIntegerInput, parseIntervalsInput } from '../src/studyCurve/settingsInput';

// 設計書 §6.1 の表（#26 の完了条件6・7）

describe('parseIntegerInput', () => {
	it('1. 数字なら整数。前後の空白と先頭の 0 は取る', () => {
		expect(parseIntegerInput('5', 0)).toEqual({ ok: true, value: 5 });
		expect(parseIntegerInput(' 5 ', 0)).toEqual({ ok: true, value: 5 });
		expect(parseIntegerInput('007', 0)).toEqual({ ok: true, value: 7 });
	});

	it('2. 全角の数字も読む', () => {
		expect(parseIntegerInput('０', 0)).toEqual({ ok: true, value: 0 });
		expect(parseIntegerInput('２０', 0)).toEqual({ ok: true, value: 20 });
		expect(parseIntegerInput('　２０　', 0)).toEqual({ ok: true, value: 20 });
	});

	it('3. 下限ちょうどは ok', () => {
		expect(parseIntegerInput('0', 0)).toEqual({ ok: true, value: 0 });
	});

	it('4. 下限より小さければエラー', () => {
		expect(parseIntegerInput('0', 1)).toEqual({
			ok: false,
			error: '1 以上の整数を入力してください',
		});
	});

	it('5. 負、小数、指数、文字、空はエラー', () => {
		for (const raw of ['-1', '2.5', '1e3', 'abc', '']) {
			expect(parseIntegerInput(raw, 0)).toEqual({
				ok: false,
				error: '0 以上の整数を入力してください',
			});
		}
	});

	it('21. 正しく表せる最大の整数は ok', () => {
		expect(parseIntegerInput('9007199254740991', 0)).toEqual({
			ok: true,
			value: Number.MAX_SAFE_INTEGER,
		});
	});

	it('22. 正しく表せない大きさはエラー', () => {
		for (const raw of ['9007199254740992', '9'.repeat(309)]) {
			expect(parseIntegerInput(raw, 0)).toEqual({ ok: false, error: '数が大きすぎます' });
		}
	});
});

describe('parseIntervalsInput', () => {
	it('6. カンマの前後の空白にかかわらず 1, 3, 7 の形にそろえる', () => {
		for (const raw of ['1, 3, 7', '1,3,7', ' 1 ,3 , 7 ']) {
			expect(parseIntervalsInput(raw)).toEqual({ ok: true, value: '1, 3, 7' });
		}
	});

	it('7. 「、」と全角の数字・カンマも読む', () => {
		for (const raw of ['1、3、7', '１，３，７', '１、３、７']) {
			expect(parseIntervalsInput(raw)).toEqual({ ok: true, value: '1, 3, 7' });
		}
	});

	it('8. 空なら ok で空（既定の間隔を使う）', () => {
		expect(parseIntervalsInput('')).toEqual({ ok: true, value: '' });
		expect(parseIntervalsInput('  ')).toEqual({ ok: true, value: '' });
	});

	it('9. 数でない部分、0、空の部分、小数、負はエラー', () => {
		for (const raw of ['1, x', '1, 0', '1,,3', '1, 3,', '1.5', '-1']) {
			expect(parseIntervalsInput(raw)).toEqual({
				ok: false,
				error: '1 以上の整数をカンマで区切って入力してください（例：1, 3, 7）',
			});
		}
	});

	it('10. 減っていく並びもそのまま（並びは利用者に任せる）', () => {
		expect(parseIntervalsInput('30, 7, 1')).toEqual({ ok: true, value: '30, 7, 1' });
	});

	it('23. 正しく表せない大きさはエラー', () => {
		expect(parseIntervalsInput('1, 1000000000000000000000')).toEqual({
			ok: false,
			error: '数が大きすぎます',
		});
	});

	it('24. 正しく表せる最大の整数は、保存した値がそのまま読める', () => {
		const parsed = parseIntervalsInput('1, 9007199254740991');
		expect(parsed).toEqual({ ok: true, value: '1, 9007199254740991' });
		if (parsed.ok) expect(parseIntervals(parsed.value)).toEqual([1, Number.MAX_SAFE_INTEGER]);
	});
});
