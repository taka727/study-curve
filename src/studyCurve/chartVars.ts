// グラフの見た目のうち、データで変わる値だけを CSS 変数で要素に渡す（#7）。
// どのプロパティに使うかは styles.css で決めるので、テーマや CSS スニペットから !important なしで上書きできる。
// Obsidian に依存しない純粋関数だけを置き、値の計算をテストで確かめる。

/** ステージ分布の段の件数（flex-grow に使う） */
export const STAGE_COUNT_VAR = '--study-curve-stage-count';
/** ステージ分布の段の濃さ（opacity に使う） */
export const STAGE_OPACITY_VAR = '--study-curve-stage-opacity';
/** 予定グラフの棒の高さ（height に使う。例 '42%'） */
export const BAR_HEIGHT_VAR = '--study-curve-bar-height';
/** 予定グラフの今日の棒のうち、遅れの分の高さ（棒に対する割合。height に使う。#90） */
export const OVERDUE_HEIGHT_VAR = '--study-curve-overdue-height';

/**
 * ステージ分布の1段に渡す変数。濃さは左（ステージ0）が 0.25、右端が 1 で、間は等分。
 * 置き換え前の式（0.25 + 0.75 * index / max(stageSlots - 1, 1)）と同じ値を、小数第3位までに丸めて返す
 * （style 属性に 0.37499999999999994 のような長い値を入れないため。見た目は変わらない）
 * @param count その段の件数（1以上。0 の段は描かない）
 * @param index ステージの番号（0 始まり）
 * @param stageSlots 段の数（設定の間隔の数）
 */
export function stageSegmentVars(
	count: number,
	index: number,
	stageSlots: number,
): Record<string, string> {
	const opacity = 0.25 + (0.75 * index) / Math.max(stageSlots - 1, 1);
	return {
		[STAGE_COUNT_VAR]: String(count),
		[STAGE_OPACITY_VAR]: String(Math.round(opacity * 1000) / 1000),
	};
}

/**
 * 予定グラフの1本に渡す変数。高さは最大の日を 100% とした割合（整数の %）。
 * max が 0 以下なら '0%'（呼び出し側は件数がすべて0のときグラフを描かないが、念のため）。
 * count が max を超えたら '100%'
 */
export function forecastBarVars(count: number, max: number): Record<string, string> {
	const ratio = max > 0 ? Math.min(Math.max(count / max, 0), 1) : 0;
	return { [BAR_HEIGHT_VAR]: `${Math.round(ratio * 100)}%` };
}

/**
 * 予定グラフの今日の棒で、遅れの分に渡す変数。高さは棒の全体（その日の件数）に対する割合（整数の %。#90）。
 * 遅れが1件でもあれば 1% 以上、遅れでない分が1件でもあれば 99% 以下にする
 * （丸めで片方の色が消え、遅れの有無が見えなくならないように）
 * @param overdue その日の件数のうち、遅れの件数
 * @param count その日の件数
 */
export function forecastOverdueVars(overdue: number, count: number): Record<string, string> {
	if (count <= 0 || overdue <= 0) return { [OVERDUE_HEIGHT_VAR]: '0%' };
	if (overdue >= count) return { [OVERDUE_HEIGHT_VAR]: '100%' };
	const percent = Math.min(Math.max(Math.round((overdue / count) * 100), 1), 99);
	return { [OVERDUE_HEIGHT_VAR]: `${percent}%` };
}
