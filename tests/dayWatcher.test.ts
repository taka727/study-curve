import { describe, expect, it, vi } from 'vitest';
import { DayWatcher } from '../src/studyCurve/dayWatcher';

// 設計書 §6.1 の表（#23）

function watcher(start: string) {
	let today = start;
	const onChange = vi.fn();
	const dayWatcher = new DayWatcher(() => today, onChange);
	return {
		dayWatcher,
		onChange,
		setToday: (value: string) => {
			today = value;
		},
	};
}

describe('DayWatcher', () => {
	it('1. 同じ日付なら何もしない', () => {
		const { dayWatcher, onChange } = watcher('2026-10-03');
		expect(dayWatcher.check()).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('2. 日付が変わったら onChange を1回呼ぶ', () => {
		const { dayWatcher, onChange, setToday } = watcher('2026-10-03');
		setToday('2026-10-04');
		expect(dayWatcher.check()).toBe(true);
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange).toHaveBeenCalledWith('2026-10-04');
	});

	it('3. 変わった後は、同じ日付のあいだ何度確かめても呼ばない', () => {
		const { dayWatcher, onChange, setToday } = watcher('2026-10-03');
		setToday('2026-10-04');
		dayWatcher.check();
		expect([dayWatcher.check(), dayWatcher.check(), dayWatcher.check()]).toEqual([
			false,
			false,
			false,
		]);
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('4. 日付が戻っても変わったとみなす（時刻を戻した場合）', () => {
		const { dayWatcher, setToday } = watcher('2026-10-04');
		setToday('2026-10-03');
		expect(dayWatcher.check()).toBe(true);
	});

	it('5. 年をまたぐ', () => {
		const { dayWatcher, setToday } = watcher('2026-12-31');
		setToday('2027-01-01');
		expect(dayWatcher.check()).toBe(true);
	});

	it('6. 作っただけでは呼ばない', () => {
		const { onChange } = watcher('2026-10-03');
		expect(onChange).not.toHaveBeenCalled();
	});
});
