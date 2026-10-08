export function todayISO(): string {
	const d = new Date();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${mm}-${dd}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
	const from = new Date(`${fromISO}T00:00:00`);
	const to = new Date(`${toISO}T00:00:00`);
	return Math.round((to.getTime() - from.getTime()) / 86400000);
}

export function addDays(dateISO: string, days: number): string {
	const d = new Date(`${dateISO}T00:00:00`);
	d.setDate(d.getDate() + days);
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isISODate(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** YYYY-MM-DD の形で、かつ実在する日付か（2026-02-30 は false） */
export function isCalendarDate(value: unknown): value is string {
	if (!isISODate(value)) return false;
	const [y, m, d] = value.split('-').map(Number) as [number, number, number];
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// 「9/19(金)」のような短い表記。ビューの一覧が横に広がらないようにするため。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatShort(dateISO: string): string {
	const d = new Date(`${dateISO}T00:00:00`);
	return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

// 期日からの相対表記。復習キューでは「何日サボったか」が一番知りたい情報なので
// 絶対日付より先にこちらを出す。
export function relativeLabel(dateISO: string, baseISO: string): string {
	const diff = daysBetween(baseISO, dateISO);
	if (diff === 0) return '今日';
	if (diff === 1) return '明日';
	if (diff === -1) return '昨日';
	if (diff < 0) return `${-diff}日遅れ`;
	return `${diff}日後`;
}
