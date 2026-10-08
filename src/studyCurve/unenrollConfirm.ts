import type { ConfirmOptions } from './ConfirmModal';
import type { StudyNote } from './types';

// 復習対象から外す前の確認の文言。ボード、study-today ブロック、コマンドの3か所で使う。
// Obsidian の API を呼ばない純粋関数なので、テストで文言を確かめられる。

// UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）。今のボードの文言と同じ
const TEXT = {
	title: '復習対象から解除',
	message: (name: string, stage: number, historyCount: number) =>
		`「${name}」を復習対象から解除しますか？ステージ${stage}と履歴（${historyCount}件）は失われます。`,
	confirm: '解除',
};

export function buildUnenrollConfirm(
	note: Pick<StudyNote, 'basename' | 'stage' | 'history'>,
): ConfirmOptions {
	return {
		title: TEXT.title,
		message: TEXT.message(note.basename, note.stage, note.history.length),
		confirmLabel: TEXT.confirm,
		// 履歴が消えるので赤いボタンにする
		warning: true,
	};
}
