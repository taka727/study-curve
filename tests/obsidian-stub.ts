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
export class PluginSettingTab {
	hide(): void {}
}

/** requireApiVersion が比べる、動いている Obsidian の版。既定は 1.13 より古い版。テストごとに変えてよい */
export const stubApiVersion = { current: '1.12.0' };

export function requireApiVersion(version: string): boolean {
	const have = stubApiVersion.current.split('.').map(Number);
	const need = version.split('.').map(Number);
	for (let i = 0; i < Math.max(have.length, need.length); i++) {
		const diff = (have[i] ?? 0) - (need[i] ?? 0);
		if (diff !== 0) return diff > 0;
	}
	return true;
}
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
