import { AbstractInputSuggest, App, TFile } from 'obsidian';

// 入力欄に Vault の Markdown ファイルの候補を出す。設定「復習ノートのテンプレート」で使う（#26）。
// FolderSuggest と同じ形。候補の数は AbstractInputSuggest.limit の既定（100）。
export class FileSuggest extends AbstractInputSuggest<TFile> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		/** 候補を選んだあとに呼ぶ（ファイルの有無の表示を更新するため） */
		private readonly afterSelect?: (file: TFile) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFile[] {
		const needle = query.trim().toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.toLowerCase().includes(needle))
			.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile): void {
		this.setValue(file.path);
		// 入力したときと同じく、input の変更を受け取る処理（Setting の onChange による保存）を動かす
		this.input.dispatchEvent(new Event('input'));
		this.afterSelect?.(file);
		this.close();
	}
}
