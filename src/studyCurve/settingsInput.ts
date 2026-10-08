import { formatIntervals } from './schedule';

// 設定画面の数値と復習間隔の入力を読む（#26）。正しくない入力は保存せず、理由を返す。
// Obsidian の API を呼ばない純粋な関数だけを置く（ユニットテストの対象）。

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	integer: (min: number) => `${min} 以上の整数を入力してください`,
	intervals: '1 以上の整数をカンマで区切って入力してください（例：1, 3, 7）',
	// 数として正しく表せない（16桁から精度が落ち、309桁から Infinity になる）。業務上の上限ではない
	tooLarge: '数が大きすぎます',
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 数字だけの文字列を整数にする。正しく表せる整数（Number.isSafeInteger）でなければ null */
function toSafeInteger(digits: string): number | null {
	const value = Number(digits);
	return Number.isSafeInteger(value) ? value : null;
}

/**
 * 整数の欄の入力を読む。NFKC で全角の数字や空白を半角にし、前後の空白を取ってから、
 * 数字だけ（/^\d+$/）で、正しく表せる整数で、min 以上なら ok。'007' は 7
 */
export function parseIntegerInput(raw: string, min: number): ParseResult<number> {
	const text = raw.normalize('NFKC').trim();
	if (!/^\d+$/.test(text)) return { ok: false, error: TEXT.integer(min) };
	const value = toSafeInteger(text);
	if (value === null) return { ok: false, error: TEXT.tooLarge };
	if (value < min) return { ok: false, error: TEXT.integer(min) };
	return { ok: true, value };
}

/**
 * 復習間隔の入力を読む。NFKC で全角を半角にし（「，」は「,」になる）、「,」と「、」で区切る。
 * 各部分は前後の空白を取って 1 以上の整数。空の部分（'1,,3'、末尾の ','）は誤り。
 * 全体が空（空白だけ）なら ok で value は ''（既定の間隔を使う）。
 * ok の value は保存する文字列で、formatIntervals の形（'1, 3, 7'）。並びは利用者に任せる
 */
export function parseIntervalsInput(raw: string): ParseResult<string> {
	const text = raw.normalize('NFKC');
	if (text.trim() === '') return { ok: true, value: '' };
	const intervals: number[] = [];
	for (const part of text.split(/[,、]/)) {
		const digits = part.trim();
		if (!/^\d+$/.test(digits)) return { ok: false, error: TEXT.intervals };
		const value = toSafeInteger(digits);
		if (value === null) return { ok: false, error: TEXT.tooLarge };
		if (value < 1) return { ok: false, error: TEXT.intervals };
		intervals.push(value);
	}
	return { ok: true, value: formatIntervals(intervals) };
}
