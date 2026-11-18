import { App, TFile } from 'obsidian';
import { inFolder, readStudyNote, studyStateKey } from './studyIndex';
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

/** ファイル1つの復習の状態を読む。書き込み直後の状態があれば、キャッシュの値の代わりにそれを使う */
export function readIndexedNote(
	app: App,
	file: TFile,
	override?: StudyStateOverride,
): StudyNote | null {
	const fromCache = readStudyNote(app, file);
	const overridden = override?.(file.path, fromCache);
	return overridden === undefined ? fromCache : overridden;
}

const comparePaths = (a: string, b: string): number => a.localeCompare(b, 'ja');

export function buildStudyIndex(app: App, override?: StudyStateOverride): StudyIndex {
	return buildIndexFrom(app.vault.getMarkdownFiles(), (file) => readIndexedNote(app, file, override));
}

function buildIndexFrom(files: TFile[], read: (file: TFile) => StudyNote | null): StudyIndex {
	const notes: StudyNote[] = [];
	const unenrolled: TFile[] = [];
	for (const file of files) {
		const note = read(file);
		if (note) notes.push(note);
		else unenrolled.push(file);
	}
	notes.sort((a, b) => comparePaths(a.filePath, b.filePath));
	unenrolled.sort((a, b) => comparePaths(a.path, b.path));
	return { notes, unenrolled };
}

/** パスの順に並んだ配列に、順番を保って入れた新しい配列を返す */
function insertSorted<T>(list: readonly T[], item: T, pathOf: (value: T) => string): T[] {
	const path = pathOf(item);
	let low = 0;
	let high = list.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (comparePaths(pathOf(list[mid]!), path) < 0) low = mid + 1;
		else high = mid;
	}
	return [...list.slice(0, low), item, ...list.slice(low)];
}

/**
 * インデックスを持ち、変わったファイルの分だけ差し替える（#13）。
 * Vault 全体を読み直すのは、最初に使うときと invalidate の後だけ。
 * update・remove は、インデックスの中身が変わったかを返す。変わっていなければ
 * ボードやブロックを描き直さなくてよい（登録していないノートの編集や、登録済みのノートの本文だけの編集）。
 * インデックスは書き換えず、変わったときは新しいオブジェクトに置き換える。
 */
export class StudyIndexStore {
	private index: StudyIndex | null = null;

	/**
	 * @param listFiles Vault の Markdown ファイルをすべて返す
	 * @param read ファイル1つの復習の状態を読む（書き込み直後の状態の差し替えも含む）。登録していなければ null
	 */
	constructor(
		private readonly listFiles: () => TFile[],
		private readonly read: (file: TFile) => StudyNote | null,
	) {}

	get(): StudyIndex {
		if (this.index === null) this.index = buildIndexFrom(this.listFiles(), this.read);
		return this.index;
	}

	/** 次に使うときに、Vault 全体から作り直す */
	invalidate(): void {
		this.index = null;
	}

	/**
	 * ファイルが作られた、または frontmatter が変わった。読み直して差し替える。
	 * まだインデックスを作っていなければ何もせず true（次に使うときに全体から作る）
	 */
	update(file: TFile): boolean {
		const index = this.index;
		if (index === null) return true;
		const note = this.read(file);
		const noteAt = index.notes.findIndex((candidate) => candidate.filePath === file.path);
		const fileAt = noteAt === -1 ? index.unenrolled.findIndex((candidate) => candidate.path === file.path) : -1;

		if (note !== null && noteAt !== -1) {
			const current = index.notes[noteAt]!;
			if (current.basename === note.basename && studyStateKey(current) === studyStateKey(note)) {
				return false;
			}
			const notes = [...index.notes];
			notes[noteAt] = note;
			this.index = { notes, unenrolled: index.unenrolled };
			return true;
		}
		if (note === null && fileAt !== -1) {
			if (index.unenrolled[fileAt] === file) return false;
			const unenrolled = [...index.unenrolled];
			unenrolled[fileAt] = file;
			this.index = { notes: index.notes, unenrolled };
			return true;
		}

		// 登録した・外した・新しいファイル。今の場所から除いて、新しい場所に入れる
		const notes = noteAt === -1 ? index.notes : index.notes.filter((_, i) => i !== noteAt);
		const unenrolled = fileAt === -1 ? index.unenrolled : index.unenrolled.filter((_, i) => i !== fileAt);
		this.index =
			note !== null
				? { notes: insertSorted(notes, note, (value) => value.filePath), unenrolled }
				: { notes, unenrolled: insertSorted(unenrolled, file, (value) => value.path) };
		return true;
	}

	/** ファイルが消えた。インデックスになければ false */
	remove(path: string): boolean {
		const index = this.index;
		if (index === null) return true;
		const notes = index.notes.filter((note) => note.filePath !== path);
		const unenrolled = index.unenrolled.filter((file) => file.path !== path);
		if (notes.length === index.notes.length && unenrolled.length === index.unenrolled.length) {
			return false;
		}
		this.index = { notes, unenrolled };
		return true;
	}
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
