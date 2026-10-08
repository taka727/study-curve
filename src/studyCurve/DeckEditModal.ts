import { App, Modal, Setting, TFolder, TextComponent } from 'obsidian';
import { errorMessage } from './actions';
import { normalizeFolderInput, validateDeckInput } from './deckInference';
import { FolderSuggest } from './FolderSuggest';
import { DeckConfig } from './types';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	titleCreate: 'デッキを作成',
	titleAdopt: 'デッキを設定に追加',
	titleEdit: 'デッキを編集',
	name: '名前',
	nameDescCreate: '資格や科目の名前。ノートの study-deck に書かれます。',
	nameDescEdit:
		'資格や科目の名前。ノートの study-deck に書かれます。変えると、このデッキのノートの study-deck も書き換えます。',
	nameDescAdopt:
		'ノートの study-deck と同じ名前です。変えるとノートとのつながりが切れるため、ここでは変えられません。',
	folder: 'フォルダ',
	folderDesc:
		'このフォルダのノートを「未登録のノート」に出し、登録時のデッキの自動判定に使います。空欄でも使えます。',
	folderPlaceholder: '例：資格/AWS',
	folderMissing: 'このフォルダはまだありません。',
	examDate: '試験日',
	examDateDesc:
		'試験日を越える復習予定は試験日に前倒しされ、直前の数日はすべてのノートが出ます。空欄でも使えます。',
	cancel: 'キャンセル',
	submitCreate: '作成',
	submitAdopt: '追加',
	submitEdit: '保存',
	saveFailed: (reason: string) => `保存に失敗しました：${reason}`,
};

export interface DeckEditOptions {
	/**
	 * create：新しく作る（名前を入力）／ adopt：ノートにある名前を設定に取り込む（名前は変えられない）／
	 * edit：設定済みのデッキを直す（#26。名前も変えられる）
	 */
	mode: 'create' | 'adopt' | 'edit';
	initial?: Partial<DeckConfig>;
	/**
	 * 重複の確認に使うデッキ名を返す。確定のボタンを押すたびに呼び、その時点の設定で確かめる
	 * （開いている間にほかの場所でデッキが足されても見逃さない）。edit では、直しているデッキ自身を除く
	 */
	existingNames: () => string[];
	/**
	 * 確定したときに呼ぶ。false を返したら閉じずに、入力を残して押し直せるように戻す（失敗の通知は
	 * onSubmit の側で出す）。それ以外（true、何も返さない）なら閉じる。
	 * 例外を投げたら、フォームのエラーの欄に「保存に失敗しました：…」を出して閉じない
	 */
	onSubmit: (deck: DeckConfig) => void | boolean | Promise<void | boolean>;
	/**
	 * 名前の欄が変わるたびに（開いた直後にも1回）呼ぶ（#22 の edit）。hint は名前の欄の下に出す説明
	 * （null なら出さない）、submitLabel は確定ボタンの文言。押す前に、ノートを何件書き換えるかを見せる
	 */
	describeName?: (name: string) => { hint: string | null; submitLabel: string };
}

// デッキを作る（ノートにあるデッキ名を設定に取り込む、設定済みのデッキを直す）ダイアログ。
// 復習ボードの案内と、設定画面の「デッキを追加」・デッキの行の「編集」から開く。
export class DeckEditModal extends Modal {
	private submitting = false;

	constructor(
		app: App,
		private readonly options: DeckEditOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, options } = this;
		const adopt = options.mode === 'adopt';
		const initial = options.initial ?? {};
		const labels = {
			create: { title: TEXT.titleCreate, submit: TEXT.submitCreate, nameDesc: TEXT.nameDescCreate },
			adopt: { title: TEXT.titleAdopt, submit: TEXT.submitAdopt, nameDesc: TEXT.nameDescAdopt },
			edit: { title: TEXT.titleEdit, submit: TEXT.submitEdit, nameDesc: TEXT.nameDescEdit },
		}[options.mode];
		this.setTitle(labels.title);

		let nameInput!: TextComponent;
		let folderInput!: TextComponent;
		let examInput!: TextComponent;

		new Setting(contentEl)
			.setName(TEXT.name)
			.setDesc(labels.nameDesc)
			.addText((text) => {
				nameInput = text;
				text.setValue(initial.name ?? '').setDisabled(adopt);
			});
		// 名前を変えたときに書き換えるノートの件数など（#22）。エラーではないので、小さい灰色の文字で出す
		const nameHintEl = options.describeName
			? contentEl.createDiv({ cls: 'study-curve-input-hint', attr: { 'aria-live': 'polite' } })
			: null;

		new Setting(contentEl)
			.setName(TEXT.folder)
			.setDesc(TEXT.folderDesc)
			.addText((text) => {
				folderInput = text;
				text.setPlaceholder(TEXT.folderPlaceholder).setValue(initial.folder ?? '');
				new FolderSuggest(this.app, text.inputEl);
			});

		new Setting(contentEl)
			.setName(TEXT.examDate)
			.setDesc(TEXT.examDateDesc)
			.addText((text) => {
				examInput = text;
				// 日付ピッカー。対応しない環境では文字入力になるが、送信時に検証する
				text.inputEl.type = 'date';
				text.setValue(initial.examDate ?? '');
			});

		// エラーと警告は行の下ではなく、ボタンの上にまとめて出す（狭い画面で行の高さが揺れないように）
		// 中身が変わったらスクリーンリーダーが読み上げるようにする（警告は控えめに、エラーはすぐに）
		const warningEl = contentEl.createDiv({
			cls: 'study-curve-form-warning',
			attr: { role: 'status', 'aria-live': 'polite' },
		});
		const errorEl = contentEl.createDiv({
			cls: 'study-curve-form-error',
			attr: { role: 'alert' },
		});
		const updateFolderWarning = () => {
			const folder = normalizeFolderInput(folderInput.getValue());
			const exists =
				folder === '' || this.app.vault.getAbstractFileByPath(folder) instanceof TFolder;
			warningEl.setText(exists ? '' : TEXT.folderMissing);
		};
		folderInput.inputEl.addEventListener('input', updateFolderWarning);
		updateFolderWarning();

		const buttonRow = contentEl.createDiv({ cls: 'study-curve-modal-buttons' });
		const cancelButton = buttonRow.createEl('button', { text: TEXT.cancel });
		const submitButton = buttonRow.createEl('button', {
			cls: 'mod-cta',
			text: labels.submit,
		});
		const describeName = options.describeName;
		if (describeName && nameHintEl) {
			const updateName = () => {
				const { hint, submitLabel } = describeName(nameInput.getValue());
				nameHintEl.setText(hint ?? '');
				submitButton.setText(submitLabel);
			};
			nameInput.inputEl.addEventListener('input', updateName);
			updateName();
		}

		const submit = async () => {
			if (this.submitting) return; // 連打しても1回だけ
			// 重複は確定の時点の設定で確かめる。ここから onSubmit が設定を書き換えるまでに await はない
			const { deck, errors } = validateDeckInput(
				{
					name: nameInput.getValue(),
					folder: folderInput.getValue(),
					examDate: examInput.getValue(),
				},
				options.existingNames(),
			);
			errorEl.empty();
			for (const error of errors) errorEl.createDiv({ text: error.message });
			if (!deck) return;

			this.submitting = true;
			cancelButton.disabled = true;
			submitButton.disabled = true;
			let result: void | boolean = false;
			try {
				result = await options.onSubmit(deck);
			} catch (error) {
				// 通知が出ない失敗（設定の保存の例外など）は、理由をダイアログに出す。設定は元に戻っているので押し直せる
				console.error(error);
				errorEl.setText(TEXT.saveFailed(errorMessage(error)));
			}
			if (result !== false) {
				this.close();
				return;
			}
			// 入力を残し、押し直せるように戻す
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
		let composing = false;
		contentEl.addEventListener('compositionstart', () => {
			composing = true;
		});
		contentEl.addEventListener('compositionend', () => {
			window.setTimeout(() => {
				composing = false;
			}, 0);
		});
		contentEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') return;
			// 日本語の変換を確定する Enter と、フォルダの候補を選ぶ Enter では送信しない
			if (event.isComposing || composing || event.defaultPrevented) return;
			if (event.target instanceof HTMLButtonElement) return; // ボタンは click で動く
			event.preventDefault();
			void submit();
		});

		(adopt ? folderInput : nameInput).inputEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
