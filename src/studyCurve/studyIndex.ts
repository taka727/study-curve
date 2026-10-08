import { App, TFile } from 'obsidian';
import { isISODate } from './dateUtils';
import { DeckConfig, Grade, GRADE_TOKENS, ReviewLogEntry, StudyNote } from './types';

// frontmatter のキー。Dataview からも素直に読めるよう、絵文字やインライン
// フィールドではなく普通の YAML キーで持つ。
export const FM_DECK = 'study-deck';
export const FM_NEXT = 'study-next';
export const FM_STAGE = 'study-stage';
export const FM_HISTORY = 'study-history';
export const FM_SUSPENDED = 'study-suspended';

const TOKEN_TO_GRADE: Record<string, Grade> = {
	ok: 'good',
	good: 'good',
	hard: 'hard',
	ng: 'again',
	again: 'again',
	new: 'fresh',
	fresh: 'fresh',
};

// 履歴1行は "YYYY-MM-DD ok" の形。読み取りはトークン欠落にも耐える
// （手で追記したときに日付だけ書かれても落とさない）。
export function parseHistoryEntry(raw: unknown): ReviewLogEntry | null {
	if (typeof raw !== 'string') return null;
	const match = /^(\d{4}-\d{2}-\d{2})(?:\s+(\S+))?/.exec(raw.trim());
	if (!match) return null;
	const token = (match[2] ?? 'ok').toLowerCase();
	return { date: match[1]!, grade: TOKEN_TO_GRADE[token] ?? 'good' };
}

export function formatHistoryEntry(entry: ReviewLogEntry): string {
	return `${entry.date} ${GRADE_TOKENS[entry.grade]}`;
}

/**
 * frontmatter の study-stage を読む。数値でなければ 0。
 * 文字列の "3" などへの対応は #32（P3）で行う。今は readStudyNote と同じ挙動に揃えるだけ。
 */
export function parseStage(raw: unknown): number {
	return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(Math.trunc(raw), 0) : 0;
}

function parseHistory(raw: unknown): ReviewLogEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map(parseHistoryEntry)
		.filter((entry): entry is ReviewLogEntry => entry !== null);
}

export function readStudyNote(
	app: App,
	file: TFile,
): StudyNote | null {
	const fm = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!fm) return null;
	return studyNoteFromFrontmatter(file.path, file.basename, fm);
}

/**
 * frontmatter の study-* から復習対象のノートを組み立てる。study-deck がなければ null。
 * metadataCache から読むときと、書き込んだ直後の frontmatter から作るとき（StudyActions）で
 * 同じ読み方をするために分けてある。
 */
export function studyNoteFromFrontmatter(
	filePath: string,
	basename: string,
	fm: Record<string, unknown>,
): StudyNote | null {
	const deckRaw: unknown = fm[FM_DECK];
	if (typeof deckRaw !== 'string' || deckRaw.trim() === '') return null;

	const nextRaw: unknown = fm[FM_NEXT];

	return {
		filePath,
		basename,
		deck: deckRaw.trim(),
		stage: parseStage(fm[FM_STAGE]),
		nextDate: isISODate(nextRaw) ? nextRaw : null,
		history: parseHistory(fm[FM_HISTORY]),
		suspended: fm[FM_SUSPENDED] === true,
	};
}

/**
 * 復習の状態（study-* から読んだ値）が同じかを比べるためのキー。
 * 書き込んだ内容が metadataCache に反映されたかを、変更の通知の届いた順番ではなく中身で判断する。
 */
export function studyStateKey(note: StudyNote | null): string {
	if (note === null) return 'null';
	return JSON.stringify([note.deck, note.stage, note.nextDate, note.history, note.suspended]);
}

export function inFolder(path: string, folder: string): boolean {
	const trimmed = folder.replace(/\/+$/, '');
	if (trimmed === '') return false;
	return path === trimmed || path.startsWith(`${trimmed}/`);
}

// ノートのパスからデッキを推測する。設定済みデッキのフォルダのうち、
// 最も深く一致したものを採用する（AWS_Certifications 配下に ANS/DOP が
// 並ぶような入れ子構成で、親側のデッキに吸われないようにするため）。
export function resolveDeckForPath(
	path: string,
	decks: DeckConfig[],
): DeckConfig | null {
	let best: DeckConfig | null = null;
	for (const deck of decks) {
		if (!inFolder(path, deck.folder)) continue;
		if (!best || deck.folder.length > best.folder.length) best = deck;
	}
	return best;
}

export function findDeck(name: string, decks: DeckConfig[]): DeckConfig | null {
	return decks.find((deck) => deck.name === name) ?? null;
}

// 設定にないデッキ名が frontmatter に書かれている場合でも見失わないよう、
// 実在するデッキ名をすべて集めて設定側とマージする。
export function allDeckNames(notes: StudyNote[], decks: DeckConfig[]): string[] {
	const names = new Set<string>(decks.map((deck) => deck.name));
	for (const note of notes) names.add(note.deck);
	return [...names].sort((a, b) => a.localeCompare(b, 'ja'));
}

/** デッキ名ごとのノートの数（休止中も含む）。設定画面の一覧（#26）、名前の変更（#22）、削除（#25）で使う */
export function countNotesByDeck(notes: Pick<StudyNote, 'deck'>[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const note of notes) counts.set(note.deck, (counts.get(note.deck) ?? 0) + 1);
	return counts;
}
