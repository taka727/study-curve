import { App, TFile } from 'obsidian';
import { inFolder, readStudyNote } from './studyIndex';
import { DeckConfig, StudyNote } from './types';

// Vault 全体を1回走査して作るスナップショット。
// iPad / Pixel では Mac と比べて明らかに遅いので、描画のたびに
// getMarkdownFiles() + getFileCache() を回すのをやめ、
// メタデータが変わったときだけ作り直す。
export interface StudyIndex {
	notes: StudyNote[];
	// study-deck を持たない Markdown ファイル。デッキフォルダとの突き合わせは
	// 参照側で行う（デッキ設定を変えただけならインデックスを作り直さずに済む）。
	unenrolled: TFile[];
}

/**
 * ノートごとに、キャッシュから読んだ状態の代わりに使う状態を返す。undefined ならキャッシュの値を使う。
 * 書き込み直後でまだ metadataCache に反映されていないノートに、書き込んだ状態を使うためのもの
 */
export type StudyStateOverride = (
	filePath: string,
	fromCache: StudyNote | null,
) => StudyNote | null | undefined;

export function buildStudyIndex(app: App, override?: StudyStateOverride): StudyIndex {
	const notes: StudyNote[] = [];
	const unenrolled: TFile[] = [];
	for (const file of app.vault.getMarkdownFiles()) {
		const fromCache = readStudyNote(app, file);
		const overridden = override?.(file.path, fromCache);
		const note = overridden === undefined ? fromCache : overridden;
		if (note) notes.push(note);
		else unenrolled.push(file);
	}
	notes.sort((a, b) => a.filePath.localeCompare(b.filePath, 'ja'));
	unenrolled.sort((a, b) => a.path.localeCompare(b.path, 'ja'));
	return { notes, unenrolled };
}

export function unregisteredInDeck(index: StudyIndex, deck: DeckConfig): TFile[] {
	if (deck.folder === '') return [];
	return index.unenrolled.filter((file) => inFolder(file.path, deck.folder));
}

// デッキフォルダ直下に置いたノートは dir: '' に入る。
export interface UnregisteredGroup {
	dir: string;
	files: TFile[];
}

// 未登録ノートをサブフォルダ単位でまとめる。演習日ごとにフォルダが増えていくような
// デッキ（例: AWS_Certifications/ANS/0819演習/…）では、フラットな一覧だと
// 下の方のファイルが埋もれて見えなくなるため、フォルダ単位でアコーディオン表示できるようにする。
export function groupUnregisteredByDir(
	index: StudyIndex,
	deck: DeckConfig,
): UnregisteredGroup[] {
	const prefix = `${deck.folder}/`;
	const groups = new Map<string, TFile[]>();
	for (const file of unregisteredInDeck(index, deck)) {
		const rest = file.path.startsWith(prefix)
			? file.path.slice(prefix.length)
			: file.path;
		const slash = rest.lastIndexOf('/');
		const dir = slash === -1 ? '' : rest.slice(0, slash);
		const list = groups.get(dir);
		if (list) list.push(file);
		else groups.set(dir, [file]);
	}

	// 直下（''）を先頭に、以降はフォルダ名の辞書順。
	return [...groups.entries()]
		.sort(([a], [b]) => {
			if (a === b) return 0;
			if (a === '') return -1;
			if (b === '') return 1;
			return a.localeCompare(b, 'ja');
		})
		.map(([dir, files]) => ({ dir, files }));
}
