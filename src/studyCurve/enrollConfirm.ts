import type { ConfirmOptions } from './ConfirmModal';

// まとめての登録の確認ダイアログの文言を組み立てる。Obsidian の API を呼ばない純粋関数
// （ConfirmOptions は型として読むだけ）なので、テストで文言と件数を確かめられる。

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	deckTitle: 'まとめて登録',
	folderTitle: 'フォルダ内を登録',
	rootDir: '（直下）',
	deckLead: (deck: string, n: number) =>
		`「${deck}」の未登録ノート ${n} 件を復習対象に登録します。`,
	filteredLead: (deck: string, filter: string, n: number) =>
		`「${deck}」の未登録ノートのうち、絞り込み「${filter}」に一致するフォルダの ${n} 件を復習対象に登録します。`,
	folderLead: (deck: string, dir: string, n: number) =>
		`「${deck}」の「${dir}」にある未登録ノート ${n} 件を復習対象に登録します。`,
	body: (firstReview: string) =>
		`各ノートの frontmatter に study-deck・study-stage・study-next・study-history を書き込みます。初回の復習日はすべて ${firstReview} です。`,
	confirm: (n: number) => `${n} 件を登録`,
};

/** 確認ダイアログに載せる対象の件数。残りは「ほか N 件」にまとめる */
export const ENROLL_CONFIRM_DETAILS = 5;

export interface EnrollConfirmInput {
	deckName: string;
	deckFolder: string;
	filePaths: string[];
	/** deck：デッキ単位の「すべて登録」（filter は絞り込みの文字。空なら絞り込みなし）。folder：フォルダ単位 */
	scope: { kind: 'deck'; filter: string } | { kind: 'folder'; dir: string };
	/** 初回の復習日の表示（例：9/29(火)） */
	firstReviewLabel: string;
}

export function buildEnrollConfirm(input: EnrollConfirmInput): ConfirmOptions {
	const { deckName, filePaths, scope } = input;
	const n = filePaths.length;
	let lead: string;
	if (scope.kind === 'folder') {
		lead = TEXT.folderLead(deckName, scope.dir === '' ? TEXT.rootDir : scope.dir, n);
	} else if (scope.filter.trim() !== '') {
		lead = TEXT.filteredLead(deckName, scope.filter.trim(), n);
	} else {
		lead = TEXT.deckLead(deckName, n);
	}
	return {
		title: scope.kind === 'folder' ? TEXT.folderTitle : TEXT.deckTitle,
		message: lead + TEXT.body(input.firstReviewLabel),
		details: filePaths
			.slice(0, ENROLL_CONFIRM_DETAILS)
			.map((path) => displayPath(path, input.deckFolder)),
		moreCount: Math.max(n - ENROLL_CONFIRM_DETAILS, 0),
		confirmLabel: TEXT.confirm(n),
		// 本文は書き換えず frontmatter にキーを足すだけなので青。赤は履歴が消える解除に取っておく
		warning: false,
	};
}

/**
 * デッキのフォルダからの相対パス（.md を除く）。フォルダの外なら相対化しない。
 * 確認のダイアログの一覧の表記をそろえるため、#25 のデッキの削除の確認でも使う
 */
export function displayPath(path: string, deckFolder: string): string {
	const folder = deckFolder.replace(/\/+$/, '');
	const prefix = `${folder}/`;
	const relative = folder !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path;
	return relative.replace(/\.md$/i, '');
}
