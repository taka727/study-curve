// テスト用の obsidian の差し替え。
// テスト対象の純粋関数が入っているモジュールは、obsidian を import していることがある
// （例：studyMutator.ts は TFile を instanceof で使う）。その import を解決するためだけのもので、
// Obsidian の挙動は再現しない。テストで必要になったものだけを足す。
export class TFile {
	path = '';
	basename = '';
	extension = 'md';
}

/** 出した通知の文言。StudyActions のテストで、どの通知が出たかを確かめるために使う */
export const noticeLog: string[] = [];

export class Notice {
	constructor(message: string | DocumentFragment, _duration?: number) {
		if (typeof message === 'string') noticeLog.push(message);
	}
	setMessage(_message: string | DocumentFragment): this {
		return this;
	}
	hide(): void {}
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
}

// settings.ts（mergeSettings のテスト）が import するクラス。中身は使わない
export class PluginSettingTab {}
export class Setting {}
// settings.ts が import するデッキ作成ダイアログ（DeckEditModal、FolderSuggest）が継承するクラス
export class Modal {}
export class AbstractInputSuggest {}
export class TFolder {
	path = '';
	isRoot(): boolean {
		return this.path === '' || this.path === '/';
	}
}
