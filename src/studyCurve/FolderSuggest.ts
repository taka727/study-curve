import { AbstractInputSuggest, App, TFolder } from 'obsidian';

// 入力欄に Vault のフォルダの候補を出す。デッキ作成ダイアログで使う（P2 の #26 の設定画面でも使う想定）。
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.trim().toLowerCase();
		return this.app.vault
			.getAllFolders(false) // ルート（Vault の直下）は含めない
			.filter((folder) => folder.path.toLowerCase().includes(needle))
			.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		// 入力したときと同じく、input の変更を受け取る処理（存在しないフォルダの警告など）を動かす
		this.input.dispatchEvent(new Event('input'));
		this.close();
	}
}
