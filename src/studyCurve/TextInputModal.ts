import { App, Modal, TextComponent } from 'obsidian';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	cancel: 'キャンセル',
};

export interface TextInputOptions {
	title: string;
	placeholder?: string;
	initialValue?: string;
	submitLabel: string;
	/** 入力のたびに呼び、入力欄の下に出す文（ファイル名の確認など）。null なら出さない */
	describe?: (value: string) => string | null;
	/** エラーの文言を返すと送信しない */
	validate?: (value: string) => string | null;
}

// 1行の文字を入れてもらうダイアログ（#10 の「復習ノートを作成」のタイトル入力）。
// 送信は確定のボタンと Enter。送信中はボタンを無効にする（二重に作らない）。
// onSubmit が true を返したら閉じ、false なら入力を残して押し直せるように戻す（DeckEditModal と同じ）
export class TextInputModal extends Modal {
	private submitting = false;

	constructor(
		app: App,
		private readonly options: TextInputOptions,
		/** 終わったら true（閉じる）。失敗したら false（入力を残す。通知は onSubmit の側で出す） */
		private readonly onSubmit: (value: string) => Promise<boolean>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		this.setTitle(options.title);

		const input = new TextComponent(contentEl)
			.setPlaceholder(options.placeholder ?? '')
			.setValue(options.initialValue ?? '');
		input.inputEl.addClass('study-curve-text-input');
		const hintEl = contentEl.createDiv({ cls: 'study-curve-input-hint' });
		const errorEl = contentEl.createDiv({
			cls: 'study-curve-form-error',
			attr: { role: 'alert' },
		});
		const updateHint = () => {
			hintEl.setText(options.describe?.(input.getValue()) ?? '');
		};
		input.onChange(() => {
			updateHint();
			errorEl.empty();
		});
		updateHint();

		const buttonRow = contentEl.createDiv({ cls: 'study-curve-modal-buttons' });
		const cancelButton = buttonRow.createEl('button', { text: TEXT.cancel });
		const submitButton = buttonRow.createEl('button', {
			cls: 'mod-cta',
			text: options.submitLabel,
		});

		const submit = async () => {
			if (this.submitting) return; // 連打しても1回だけ
			const value = input.getValue();
			const error = options.validate?.(value) ?? null;
			errorEl.setText(error ?? '');
			if (error !== null) return;
			this.submitting = true;
			cancelButton.disabled = true;
			submitButton.disabled = true;
			let done = false;
			try {
				done = await this.onSubmit(value);
			} catch (error) {
				console.error(error);
			}
			if (done) {
				this.close();
				return;
			}
			this.submitting = false;
			cancelButton.disabled = false;
			submitButton.disabled = false;
		};

		cancelButton.addEventListener('click', () => this.close());
		submitButton.addEventListener('click', () => {
			void submit();
		});
		// iPad の Safari（WebKit）は、変換を確定する Enter の keydown より先に compositionend を出し、
		// その keydown の isComposing は false になる。そのため変換の終わりは次のタスクまで遅らせて覚える
		// （DeckEditModal と同じ）
		let composing = false;
		input.inputEl.addEventListener('compositionstart', () => {
			composing = true;
		});
		input.inputEl.addEventListener('compositionend', () => {
			window.setTimeout(() => {
				composing = false;
			}, 0);
		});
		input.inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			// 日本語の変換を確定する Enter では送信しない
			if (event.isComposing || composing) return;
			event.preventDefault();
			void submit();
		});

		input.inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
