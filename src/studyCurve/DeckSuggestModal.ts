import { App, SuggestModal } from 'obsidian';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	adoptAndEnroll: '設定に追加して登録',
	empty: 'デッキ名を入力すると、新しいデッキを作成します',
};

// フォルダからデッキを自動判定できなかったときだけ開く。
// デッキ名は設定済みのものに加え、既存ノートで使われている名前も候補に出す。
// 設定にない名前（ノートにだけある名前、新しく入力した名前）を選ぶと、呼び出し側で設定にも追加する。
export class DeckSuggestModal extends SuggestModal<string> {
	constructor(
		app: App,
		private deckNames: string[],
		/** deckNames のうち、設定にあるデッキ名 */
		private configuredNames: string[],
		private onChoose: (deckName: string) => void,
	) {
		super(app);
		this.setPlaceholder('デッキを選択（新しい名前を入力してもよい）');
		this.emptyStateText = TEXT.empty;
	}

	getSuggestions(query: string): string[] {
		const lower = query.toLowerCase();
		const matched = this.deckNames.filter((name) =>
			name.toLowerCase().includes(lower),
		);
		const trimmed = query.trim();
		// 完全一致が無ければ、入力そのものを新規デッキ名の候補として先頭に出す。
		if (trimmed !== '' && !this.deckNames.includes(trimmed)) {
			return [trimmed, ...matched];
		}
		return matched;
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.createDiv({ text: value });
		if (!this.deckNames.includes(value)) {
			el.createDiv({ cls: 'study-curve-empty', text: '新しいデッキとして登録' });
		} else if (!this.configuredNames.includes(value)) {
			el.createDiv({ cls: 'study-curve-empty', text: TEXT.adoptAndEnroll });
		}
	}

	onChooseSuggestion(value: string): void {
		this.onChoose(value);
	}
}
