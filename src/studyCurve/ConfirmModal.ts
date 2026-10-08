import { App, Modal } from 'obsidian';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	cancel: 'キャンセル',
	more: (n: number) => `ほか ${n} 件`,
};

export interface ConfirmOptions {
	title?: string;
	message: string;
	/** 対象の一覧（先頭の数件だけ渡す） */
	details?: string[];
	/** details に載せきれなかった件数。1以上なら「ほか N 件」と表示 */
	moreCount?: number;
	confirmLabel: string;
	/** true なら確定ボタンを mod-warning（取り消せない操作）、false なら mod-cta */
	warning?: boolean;
	/**
	 * 確定のボタンの左に出す、もう1つの確定の選択肢（#25 のデッキの削除の「復習対象から外して削除」）。
	 * 押すと onConfirm ではなく run を呼ぶ。押した後の扱い（すべてのボタンを無効にする、連打しても1回、
	 * 終わったら閉じる）は確定のボタンと同じ
	 */
	alternative?: {
		label: string;
		/** true なら mod-warning、false なら mod-cta、省略なら色なし */
		warning?: boolean;
		run: () => void | Promise<void>;
	};
}

// 復習対象からの解除やまとめての登録など、ノートを書き換える操作の前に一度確認する。
// 確定したら処理が終わるまですべてのボタンを無効にし、連打しても（2つの確定のボタンを続けて押しても）1回だけ実行する。
// 長い処理（まとめての登録）は、onConfirm で開始するだけにしてすぐ閉じる（進み具合は通知で出す）。
export class ConfirmModal extends Modal {
	private running = false;

	constructor(
		app: App,
		private options: ConfirmOptions,
		private onConfirm: () => void | Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		if (options.title) this.setTitle(options.title);
		contentEl.createEl('p', { text: options.message });

		if (options.details && options.details.length > 0) {
			const list = contentEl.createEl('ul', { cls: 'study-curve-confirm-details' });
			for (const item of options.details) list.createEl('li', { text: item });
			const more = options.moreCount ?? 0;
			if (more > 0) {
				list.createEl('li', { cls: 'study-curve-confirm-more', text: TEXT.more(more) });
			}
		}

		// 並び：キャンセル ／ alternative ／ 確定（右端）
		const buttonRow = contentEl.createDiv({ cls: 'study-curve-modal-buttons' });
		const cancelButton = buttonRow.createEl('button', { text: TEXT.cancel });
		const { alternative } = options;
		let alternativeButton: HTMLButtonElement | null = null;
		if (alternative) {
			// 色は指定したときだけ（省略なら標準のボタン）
			const color =
				alternative.warning === undefined ? [] : [alternative.warning ? 'mod-warning' : 'mod-cta'];
			alternativeButton = buttonRow.createEl('button', { text: alternative.label, cls: color });
		}
		const confirmButton = buttonRow.createEl('button', {
			text: options.confirmLabel,
			cls: options.warning ? 'mod-warning' : 'mod-cta',
		});
		const buttons = [cancelButton, alternativeButton, confirmButton].filter(
			(button): button is HTMLButtonElement => button !== null,
		);
		cancelButton.addEventListener('click', () => this.close());
		confirmButton.addEventListener('click', () => {
			void this.run(buttons, this.onConfirm);
		});
		if (alternative && alternativeButton) {
			alternativeButton.addEventListener('click', () => {
				void this.run(buttons, alternative.run);
			});
		}
	}

	/** 確定の処理を1回だけ走らせる。どちらの確定のボタンでも同じ running の印を使う */
	private async run(
		buttons: HTMLButtonElement[],
		action: () => void | Promise<void>,
	): Promise<void> {
		if (this.running) return; // 連打しても1回だけ
		this.running = true;
		for (const button of buttons) button.disabled = true;
		try {
			await action();
		} catch (error) {
			// 通知は呼び出し側（StudyActions）で出す。ここでは握りつぶさずに残すだけ
			console.error(error);
		} finally {
			this.close();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
