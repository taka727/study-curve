import { isCalendarDate } from './dateUtils';
import type { DeckConfig, StudyNote } from './types';

// 既存のノートからデッキを推定する処理と、デッキの入力の検証。
// Obsidian の API を呼ばない純粋な関数だけを置く（ユニットテストの対象）。

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	nameEmpty: '名前を入力してください',
	nameDuplicate: '同じ名前のデッキがあります',
	folderDots: 'フォルダに「.」「..」は使えません',
	examDateInvalid: '日付は 2026-10-25 のように入力してください',
	// 設定画面のデッキの一覧の警告（#26）
	warnEmptyName: '名前が空です。編集して名前を付けてください。',
	warnDuplicateName:
		'同じ名前のデッキが上にあります。試験日はそちらが使われます。名前を変えるか、削除してください。',
	warnFolderMissing: (folder: string) => `フォルダ「${folder}」が見つかりません。`,
};

export interface DeckWarning {
	kind: 'emptyName' | 'duplicateName' | 'folderMissing';
	message: string;
}

/**
 * 保存済みのデッキの一覧に対する警告（#26）。戻り値の添字は decks と同じ。
 * ダイアログの検証は新しく入れる値しか見ないので、保存済みの重複や空の名前、消えたフォルダはここで知らせる。
 * 重複は、前に同じ名前（完全一致。findDeck と同じ規則）のデッキがある行にだけ出す（前のものが実際に使われる）。
 * folderExists は Vault にフォルダがあるか（呼び出し側で Vault を見る）
 */
export function deckListWarnings(
	decks: DeckConfig[],
	folderExists: (folder: string) => boolean,
): DeckWarning[][] {
	const seen = new Set<string>();
	return decks.map((deck) => {
		const warnings: DeckWarning[] = [];
		if (deck.name.trim() === '') {
			warnings.push({ kind: 'emptyName', message: TEXT.warnEmptyName });
		} else if (seen.has(deck.name)) {
			warnings.push({ kind: 'duplicateName', message: TEXT.warnDuplicateName });
		}
		seen.add(deck.name);
		if (deck.folder !== '' && !folderExists(deck.folder)) {
			warnings.push({ kind: 'folderMissing', message: TEXT.warnFolderMissing(deck.folder) });
		}
		return warnings;
	});
}

export interface InferredDeck {
	name: string;
	/** 推定したフォルダ。Vault の直下を含むなら ''（フォルダなし） */
	folder: string;
	/** そのデッキ名を持つノートの数（休止中も含む） */
	count: number;
}

/**
 * ノートのパスの親フォルダに共通する、最も深いフォルダ。
 * パスは '/' 区切りの Vault 内の相対パス（TFile.path と同じ形）。
 * 比較はフォルダ名の単位で行う（'AWS/ANS' と 'AWS/ANS2' の共通部分は 'AWS'）。
 * Vault の直下のノートを含むとき、またはパスが0件のときは ''。
 */
export function commonParentFolder(filePaths: string[]): string {
	let common: string[] | null = null;
	for (const path of filePaths) {
		const slash = path.lastIndexOf('/');
		const parts = slash === -1 ? [] : path.slice(0, slash).split('/');
		if (common === null) {
			common = parts;
			continue;
		}
		let length = 0;
		while (length < common.length && length < parts.length && common[length] === parts[length]) {
			length++;
		}
		common = common.slice(0, length);
		if (common.length === 0) break;
	}
	return (common ?? []).join('/');
}

/**
 * 設定にないデッキ名を持つノートをデッキ名ごとにまとめ、件数とフォルダを推定する。
 * 並びは件数の多い順、同数なら名前順（'ja'）。
 * デッキ名の比較は完全一致（findDeck と同じ規則。大文字と小文字を区別する）。
 */
export function inferDecksFromNotes(
	notes: Pick<StudyNote, 'deck' | 'filePath'>[],
	configured: Pick<DeckConfig, 'name'>[],
): InferredDeck[] {
	const known = new Set(configured.map((deck) => deck.name));
	const pathsByDeck = new Map<string, string[]>();
	for (const note of notes) {
		if (known.has(note.deck)) continue;
		const paths = pathsByDeck.get(note.deck);
		if (paths) paths.push(note.filePath);
		else pathsByDeck.set(note.deck, [note.filePath]);
	}
	return [...pathsByDeck.entries()]
		.map(([name, paths]) => ({
			name,
			folder: commonParentFolder(paths),
			count: paths.length,
		}))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
}

export interface DeckInput {
	name: string;
	folder: string;
	/** input type="date" の値。未入力は ''、それ以外は YYYY-MM-DD */
	examDate: string;
}

export interface DeckInputError {
	field: 'name' | 'folder' | 'examDate';
	message: string;
}

/**
 * フォルダの入力を整える。前後の空白を取り、'\' を '/' に、'/' の連続を1つにし、
 * 先頭と末尾の '/' を取る。
 */
export function normalizeFolderInput(folder: string): string {
	return folder
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');
}

/**
 * デッキ作成ダイアログの入力を検証し、整えた DeckConfig を返す。
 * エラーが1つでもあれば deck は null。名前の比較は完全一致（findDeck と同じ規則）。
 */
export function validateDeckInput(
	input: DeckInput,
	existingNames: string[],
): { deck: DeckConfig | null; errors: DeckInputError[] } {
	const errors: DeckInputError[] = [];

	const name = input.name.trim();
	if (name === '') errors.push({ field: 'name', message: TEXT.nameEmpty });
	else if (existingNames.includes(name)) {
		errors.push({ field: 'name', message: TEXT.nameDuplicate });
	}

	const folder = normalizeFolderInput(input.folder);
	if (folder.split('/').some((part) => part === '.' || part === '..')) {
		errors.push({ field: 'folder', message: TEXT.folderDots });
	}

	const examRaw = input.examDate.trim();
	const examDate = examRaw === '' ? null : examRaw;
	if (examDate !== null && !isCalendarDate(examDate)) {
		errors.push({ field: 'examDate', message: TEXT.examDateInvalid });
	}

	return {
		deck: errors.length === 0 ? { name, folder, examDate } : null,
		errors,
	};
}
