import { describe, expect, it } from 'vitest';
import { buildUnenrollConfirm } from '../src/studyCurve/unenrollConfirm';

// 設計書 §6.1 の表（#24）

const NOTE = {
	basename: 'IAM のポリシー評価',
	stage: 3,
	history: [
		{ date: '2026-09-20', grade: 'good' as const },
		{ date: '2026-09-25', grade: 'good' as const },
	],
};

describe('buildUnenrollConfirm', () => {
	it('1. 本文がボードの文言と1文字も違わない', () => {
		expect(buildUnenrollConfirm(NOTE).message).toBe(
			'「IAM のポリシー評価」を復習対象から解除しますか？ステージ3と履歴（2件）は失われます。',
		);
	});

	it('2. 題名、確定ボタン、赤いボタン', () => {
		const options = buildUnenrollConfirm(NOTE);
		expect(options.title).toBe('復習対象から解除');
		expect(options.confirmLabel).toBe('解除');
		expect(options.warning).toBe(true);
	});

	it('3. 対象の一覧は出さない', () => {
		const options = buildUnenrollConfirm(NOTE);
		expect(options.details).toBeUndefined();
		expect(options.moreCount).toBeUndefined();
	});

	it('4. ステージ0・履歴0件', () => {
		expect(buildUnenrollConfirm({ ...NOTE, stage: 0, history: [] }).message).toContain(
			'ステージ0と履歴（0件）は失われます。',
		);
	});

	it('5. 名前は加工せずにそのまま入れる', () => {
		expect(buildUnenrollConfirm({ ...NOTE, basename: 'Note「A」🧠' }).message).toContain(
			'「Note「A」🧠」',
		);
	});
});
