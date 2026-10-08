// 開いたままで日付が変わったことに気づくための小さな仕組み（#23）。
// Obsidian に依存しないので、日付の比較をテストで確かめられる。

/** 日付が変わったかを確かめる間隔（1分おき） */
export const DAY_CHECK_INTERVAL_MS = 60_000;

/**
 * 最後に見た日付（YYYY-MM-DD）を持ち、check() のたびに今日の日付と比べる。
 * 違っていれば onChange を1回呼び、新しい日付を覚える。
 * 前後は問わない（時刻を戻した、タイムゾーンを変えた場合も「変わった」とみなす）。
 */
export class DayWatcher {
	private last: string;

	constructor(
		private readonly today: () => string,
		private readonly onChange: (today: string) => void,
	) {
		this.last = today();
	}

	/** 日付が変わっていたら onChange を呼んで true。変わっていなければ何もせず false */
	check(): boolean {
		const now = this.today();
		if (now === this.last) return false;
		this.last = now;
		this.onChange(now);
		return true;
	}
}
