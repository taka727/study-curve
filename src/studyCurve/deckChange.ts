import type { ConfirmOptions } from './ConfirmModal';
import { ENROLL_CONFIRM_DETAILS, displayPath } from './enrollConfirm';

// 設定でデッキの名前を変える（#22）・デッキを削除する（#25）ときの、ノートへの影響と文言を組み立てる。
// Obsidian の API を呼ばない純粋な関数だけを置く（ユニットテストの対象。ConfirmOptions は型として読むだけ）。

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	// デッキの削除の確認（#25）
	removeTitle: 'デッキを削除',
	unnamed: '（名前なし）',
	removeWithNotes: (name: string, count: number) =>
		`「${name}」を設定から削除します。このデッキのノートが ${count} 件あります。` +
		'「ノートを残して削除」では、ノートの study-* はそのまま残り、復習も続きます（ボードの「設定に無いデッキ名です」から設定に戻せます。試験日は入れ直しが必要です）。' +
		'「復習対象から外して削除」では、各ノートから study-deck・study-stage・study-next・study-history・study-suspended を消します。ステージと履歴は元に戻せません。ノートの本文とほかの frontmatter は変わりません。',
	removeNoNotes: (name: string) => `「${name}」を設定から削除します。このデッキのノートはありません。`,
	removeShared: (name: string, count: number) =>
		`「${name}」を設定から削除します。同じ名前のデッキがほかにもあるため、ノート ${count} 件はそのデッキのまま残ります。`,
	keepAndRemove: 'ノートを残して削除',
	unenrollAndRemove: (count: number) => `${count} 件を復習対象から外して削除`,
	remove: '削除',
	// デッキの名前の変更（#22）
	rewrite: (count: number, to: string) =>
		`このデッキのノート ${count} 件の study-deck を「${to}」に書き換えます。`,
	merge: (count: number, to: string) => `すでに「${to}」のノートが ${count} 件あり、1つのデッキになります。`,
	notRewritten:
		'コードブロック（study-today など）の deck: と、Templater の getDueQueue に書いた名前は書き換えません。',
	adopt: (count: number, to: string) => `「${to}」のノート ${count} 件が、このデッキのノートになります。`,
	sharedOldName: (from: string) =>
		`同じ名前「${from}」のデッキがほかにもあるため、ノートは書き換えません。`,
	save: '保存',
	saveAndRewrite: (count: number) => `保存して ${count} 件を書き換える`,
};

export interface DeckRenamePlan {
	from: string;
	to: string;
	/** 書き換えるノートの数。0 なら設定だけを保存する */
	rewriteCount: number;
	/** 新しい名前をすでに持つノートの数（設定にない名前のノート） */
	mergeCount: number;
	/** 古い名前のデッキが設定にもう1つあるので、ノートを書き換えない（そのノートはもう1つのデッキのもの） */
	sharedOldName: boolean;
}

/**
 * 名前を from から to に変えたときに、どのノートが書き換わるか。
 * to が空、または設定のほかのデッキと同じ名前なら、何も書き換えない（変えていないのと同じ）とする。
 * どちらも編集のダイアログの検証（#26）で保存できないので、入力の途中に「N 件を書き換えます」
 * 「1つのデッキになります」と見せてから確定で断る、という食い違いを出さないため
 */
export function planDeckRename(input: {
	from: string;
	/** 前後の空白を取った新しい名前 */
	to: string;
	/** 直しているデッキを除いた、設定のデッキ名 */
	otherDeckNames: string[];
	/** countNotesByDeck（#26）の結果 */
	noteCounts: ReadonlyMap<string, number>;
}): DeckRenamePlan {
	const { from, to, otherDeckNames, noteCounts } = input;
	if (from === to || to === '' || otherDeckNames.includes(to)) {
		return { from, to, rewriteCount: 0, mergeCount: 0, sharedOldName: false };
	}
	const mergeCount = noteCounts.get(to) ?? 0;
	if (otherDeckNames.includes(from)) {
		return { from, to, rewriteCount: 0, mergeCount, sharedOldName: true };
	}
	return { from, to, rewriteCount: noteCounts.get(from) ?? 0, mergeCount, sharedOldName: false };
}

/** 名前の欄の下に出す説明。出すものがなければ null */
export function renameHint(plan: DeckRenamePlan): string | null {
	if (plan.from === plan.to) return null;
	if (plan.sharedOldName) return TEXT.sharedOldName(plan.from);
	if (plan.rewriteCount > 0) {
		const merge = plan.mergeCount > 0 ? TEXT.merge(plan.mergeCount, plan.to) : '';
		return `${TEXT.rewrite(plan.rewriteCount, plan.to)}${merge}${TEXT.notRewritten}`;
	}
	if (plan.mergeCount > 0) return TEXT.adopt(plan.mergeCount, plan.to);
	return null;
}

/** 確定ボタンの文言。書き換えるノートがあれば件数を入れる */
export function renameSubmitLabel(plan: DeckRenamePlan): string {
	return plan.rewriteCount > 0 ? TEXT.saveAndRewrite(plan.rewriteCount) : TEXT.save;
}

export interface DeckRemoveConfirmInput {
	deckName: string;
	deckFolder: string;
	/** そのデッキ名のノートのパス（インデックスの順＝パスの順）。使うのは件数と先頭の数件 */
	notePaths: string[];
	/** 同じ名前のデッキが設定にもう1つある（ノートはそちらのデッキのまま残る） */
	sharedName: boolean;
}

export interface DeckRemoveConfirm {
	/** alternative は含まない（run は呼び出し側で付ける） */
	options: ConfirmOptions;
	/** 「復習対象から外して削除」のボタンの文言。出さないなら null */
	unenrollLabel: string | null;
}

/**
 * デッキの削除の確認の文言（#25）。ノートがあれば「ノートを残して削除」（青。ボードの「設定に追加」で戻せる）と
 * 「N 件を復習対象から外して削除」（赤。ステージと履歴が消える）から選ぶ。ノートがない、または同じ名前の
 * デッキがほかにもある（ノートに触れない）なら「削除」だけ（赤。共通方針の「削除は赤」）
 */
export function buildDeckRemoveConfirm(input: DeckRemoveConfirmInput): DeckRemoveConfirm {
	const name = input.deckName.trim() === '' ? TEXT.unnamed : input.deckName;
	const count = input.notePaths.length;
	if (input.sharedName || count === 0) {
		return {
			options: {
				title: TEXT.removeTitle,
				message: input.sharedName ? TEXT.removeShared(name, count) : TEXT.removeNoNotes(name),
				confirmLabel: TEXT.remove,
				warning: true,
			},
			unenrollLabel: null,
		};
	}
	return {
		options: {
			title: TEXT.removeTitle,
			message: TEXT.removeWithNotes(name, count),
			details: input.notePaths
				.slice(0, ENROLL_CONFIRM_DETAILS)
				.map((path) => displayPath(path, input.deckFolder)),
			moreCount: Math.max(count - ENROLL_CONFIRM_DETAILS, 0),
			confirmLabel: TEXT.keepAndRemove,
			warning: false,
		},
		unenrollLabel: TEXT.unenrollAndRemove(count),
	};
}
