import { App, TFile } from 'obsidian';
import { clearChecksInSection } from './checkboxes';
import { isISODate, todayISO } from './dateUtils';
import { ScheduleResult, initialNextDate, postponeTarget, scheduleReview } from './schedule';
import {
	FM_DECK,
	FM_HISTORY,
	FM_NEXT,
	FM_STAGE,
	FM_SUSPENDED,
	formatHistoryEntry,
	parseStage,
} from './studyIndex';
import { Grade } from './types';

export const HISTORY_LIMIT = 20;

const NOT_ENROLLED_MESSAGE = 'このノートは復習対象ではありません';

/**
 * 書き換える前と後の frontmatter を受け取る。StudyActions が、metadataCache に反映されるまでの
 * あいだインデックスに後の状態を使うために渡す（キャッシュの反映を待たずに画面を新しくする）。
 * 保存が成功したあとにだけ呼ぶ。保存に失敗したのに、書いていない状態を画面に出さないため
 */
export type OnWritten = (
	before: Record<string, unknown>,
	after: Record<string, unknown>,
) => void;

/** processFrontMatter のコールバックの中で写し取った、書き換える前と後の frontmatter */
type Written = { before: Record<string, unknown>; after: Record<string, unknown> };

// processFrontMatter が渡すオブジェクトはコールバックの外では使えないので、値を写し取る。
// frontmatter は YAML から読んだ値なので、JSON の往復で失うものはない
function snapshot(fm: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
}

function getFile(app: App, filePath: string): TFile | null {
	const file = app.vault.getAbstractFileByPath(filePath);
	return file instanceof TFile ? file : null;
}

/**
 * 見出しに keyword を含むセクションの完了チェックを外す（「思い出せるか」の自己チェックを
 * 毎回やり直すため）。書き換えたら true。
 * 外すものがなければ書き込まない（更新日時の変化や、同期・git の差分を出さないため）。
 * 事前の確認は vault.read（ディスクから読む）で行う。cachedRead はエディタや同期で足された
 * チェックをまだ含まないことがあり、外し損ねるため。実際の書き換えは Vault.process が
 * コールバックに渡す最新の本文に対して行う（読み込みと書き込みのあいだの編集や同期を上書きしない）。
 * process のコールバックが同じ文字列を返したときに書き込みが起きるかは型定義に記載がないので、
 * 事前の確認で避ける
 */
async function clearSectionChecks(app: App, file: TFile, keyword: string): Promise<boolean> {
	const current = await app.vault.read(file);
	if (clearChecksInSection(current, keyword) === current) return false;
	await app.vault.process(file, (data) => clearChecksInSection(data, keyword));
	return true;
}

// frontmatter の書き換えは必ず processFrontMatter を通す。
// 自前で YAML を組み立てると、既存の title や tags などの書式を壊すため。
async function updateFrontMatter(
	app: App,
	filePath: string,
	mutate: (fm: Record<string, unknown>) => void,
	onWritten?: OnWritten,
): Promise<void> {
	const file = getFile(app, filePath);
	if (!file) throw new Error(`ノートが見つかりません: ${filePath}`);
	const holder: { written?: Written } = {};
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const before = snapshot(fm);
		mutate(fm);
		holder.written = { before, after: snapshot(fm) };
	});
	if (holder.written) onWritten?.(holder.written.before, holder.written.after);
}

export interface EnrollOptions {
	/**
	 * true なら、書き込む時点で study-deck が入っているノートには何もしない（#21）。
	 * 未登録の一覧は描画した時点のものなので、その後に別の端末や手作業で登録されたノートの
	 * ステージと履歴を消さないため
	 */
	skipIfEnrolled?: boolean;
	/**
	 * 初回の復習日の基準にする今日（YYYY-MM-DD）。省略したら呼んだ時点の今日。
	 * まとめての登録で、確認ダイアログに出した日付と、途中で日付をまたいでも同じ日付にするため
	 */
	today?: string;
	/**
	 * true なら study-history を空にし、study-suspended を消す（#10）。
	 * 登録済みのノートをコピーしたテンプレートから作っても、履歴と休止を引き継がないため
	 */
	resetHistory?: boolean;
}

/**
 * 書く時点で対象でなかった（登録済みだった、ほかのデッキになっていた）ときに、processFrontMatter の
 * 書き込みを止めるための例外。値を変えなくても書き戻すと、YAML の書式が整え直されたり更新日時が変わったりするため
 */
class SkipWrite extends Error {}

/**
 * 復習対象に登録する。書き込んだら true、skipIfEnrolled で飛ばしたら false。
 * 登録済みかの判定は、processFrontMatter がファイルから読み直した最新の frontmatter で行う。
 * 飛ばすときはコールバックから例外を投げ、ファイルを書き戻さない（値を変えなくても書き戻すと、
 * YAML の書式が整え直されたり、更新日時が変わったりするため）。onWritten は書き込んだときだけ呼ぶ
 */
export async function enrollNote(
	app: App,
	filePath: string,
	deckName: string,
	intervals: number[],
	examDate: string | null,
	options: EnrollOptions = {},
	onWritten?: OnWritten,
): Promise<boolean> {
	const today = options.today ?? todayISO();
	try {
		await updateFrontMatter(
			app,
			filePath,
			(fm) => {
				const deck = fm[FM_DECK];
				if (options.skipIfEnrolled && typeof deck === 'string' && deck.trim() !== '') {
					throw new SkipWrite();
				}
				fm[FM_DECK] = deckName;
				fm[FM_STAGE] = 0;
				fm[FM_NEXT] = initialNextDate(intervals, today, examDate);
				if (options.resetHistory) {
					fm[FM_HISTORY] = [];
					delete fm[FM_SUSPENDED];
				} else if (!Array.isArray(fm[FM_HISTORY])) {
					fm[FM_HISTORY] = [];
				}
			},
			onWritten,
		);
	} catch (error) {
		if (error instanceof SkipWrite) return false;
		throw error;
	}
	return true;
}

/**
 * frontmatter の study-deck が from（前後の空白を除いて一致。大文字と小文字は区別する）なら、
 * to に書き換えて true を返す（#22）。そうでなければ何も変えずに false。ほかのキーは触らない。
 * Obsidian の API を呼ばない純粋な処理なので、プレーンなオブジェクトでテストできる
 */
export function applyDeckRename(fm: Record<string, unknown>, from: string, to: string): boolean {
	const deck = fm[FM_DECK];
	if (typeof deck !== 'string' || deck.trim() !== from) return false;
	fm[FM_DECK] = to;
	return true;
}

/**
 * ノートの study-deck を from から to に書き換える（#22）。書き換えたら true、
 * 書く時点でほかのデッキになっていたら false（ファイルは書き戻さない）。
 * 判定は processFrontMatter が読み直した最新の値で行う。onWritten は書き換えたときだけ呼ぶ
 */
export async function renameDeckInNote(
	app: App,
	filePath: string,
	from: string,
	to: string,
	onWritten?: OnWritten,
): Promise<boolean> {
	try {
		await updateFrontMatter(
			app,
			filePath,
			(fm) => {
				if (!applyDeckRename(fm, from, to)) throw new SkipWrite();
			},
			onWritten,
		);
	} catch (error) {
		if (error instanceof SkipWrite) return false;
		throw error;
	}
	return true;
}

export interface GradeResult {
	stage: number;
	nextDate: string;
	clampedByExam: boolean;
	/**
	 * 採点を frontmatter に保存したあと、本文の書き換え（指定の見出しの下のチェックを外す）に
	 * 失敗したときのエラー。採点そのものは保存済みなので、失敗として扱わない
	 * （扱うと、押し直しで二重に記録される）
	 */
	bodyError?: Error;
}

export interface GradeOptions {
	intervals: number[];
	/** デッキ名から試験日を引く。frontmatter から読んだ最新のデッキ名で呼ばれる */
	examDateFor: (deckName: string) => string | null;
	/**
	 * 採点後にチェックを外すセクションの、見出しに含まれる文字列。null なら外さない。
	 * 空の文字列も何も外さないが、呼び出し側で null にしてファイルを読みにいかないようにする
	 */
	checkSection: string | null;
}

/**
 * frontmatter（processFrontMatter が渡すオブジェクト）に採点1回分を書き込み、計算結果を返す。
 * Obsidian の API を呼ばない純粋な処理なので、プレーンなオブジェクトでテストできる。
 * stage と次回日付の計算は schedule.ts に寄せてあるので、ここは読み書きだけを担当する。
 * @throws 復習対象でない（study-deck がない）とき。このとき fm は変更しない
 */
export function applyGrade(
	fm: Record<string, unknown>,
	grade: Grade,
	today: string,
	intervals: number[],
	examDateFor: (deckName: string) => string | null,
): ScheduleResult {
	const deckRaw = fm[FM_DECK];
	if (typeof deckRaw !== 'string' || deckRaw.trim() === '') {
		throw new Error(NOT_ENROLLED_MESSAGE);
	}
	const result = scheduleReview(
		parseStage(fm[FM_STAGE]),
		grade,
		intervals,
		today,
		examDateFor(deckRaw.trim()),
	);
	fm[FM_STAGE] = result.stage;
	fm[FM_NEXT] = result.nextDate;
	const history = Array.isArray(fm[FM_HISTORY])
		? (fm[FM_HISTORY] as unknown[]).map(String)
		: [];
	history.push(formatHistoryEntry({ date: today, grade }));
	// 履歴は直近だけ残す。frontmatter が際限なく伸びるとノート本文が
	// 画面外に押し出されて読みづらくなるため。
	fm[FM_HISTORY] = history.slice(-HISTORY_LIMIT);
	return result;
}

// 復習1回分を記録する。ステージは metadataCache ではなく、processFrontMatter が
// ファイルから読み直した最新の frontmatter から計算する。キャッシュの反映を待たずに
// 続けて書き込んでも、古いステージから計算してしまわないようにするため。
export async function gradeNote(
	app: App,
	filePath: string,
	grade: Grade,
	options: GradeOptions,
	onWritten?: OnWritten,
): Promise<GradeResult> {
	const file = getFile(app, filePath);
	if (!file) throw new Error(`ノートが見つかりません：${filePath}`);
	const today = todayISO();

	// processFrontMatter は Promise<void> を返すので、結果はコールバックの外の入れ物で受け取る。
	// `let result: ScheduleResult | null = null` だと、TypeScript はコールバック内の代入を
	// 追跡できず、呼び出し後も null 型のままと判断する。そのためオブジェクトのプロパティに入れる。
	// applyGrade が例外を投げたときは、processFrontMatter はファイルを書かずに投げ直す。
	const holder: { result?: ScheduleResult; written?: Written } = {};
	await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
		const before = snapshot(fm);
		holder.result = applyGrade(fm, grade, today, options.intervals, options.examDateFor);
		holder.written = { before, after: snapshot(fm) };
	});
	if (!holder.result || !holder.written) throw new Error('採点の結果を取得できませんでした');
	// 保存が終わってから渡す（コールバックの中で渡すと、その後の保存の失敗を画面に反映できない）
	onWritten?.(holder.written.before, holder.written.after);

	// frontmatter を書いたあとに本文を触る。どちらも最新のファイルを読んで書く
	// （processFrontMatter と Vault.process）ので、逆の順序でも上書きは起きないが、
	// 採点の記録を先に済ませ、チェックを外すのに失敗しても採点が失われないようにする。
	// ここで失敗しても採点は保存済みなので、例外にせず結果に添えて返す。
	const result: GradeResult = { ...holder.result };
	if (options.checkSection !== null) {
		try {
			await clearSectionChecks(app, file, options.checkSection);
		} catch (error) {
			result.bodyError = error instanceof Error ? error : new Error(String(error));
		}
	}
	return result;
}

export async function setSuspended(
	app: App,
	filePath: string,
	suspended: boolean,
): Promise<void> {
	await updateFrontMatter(app, filePath, (fm) => {
		if (suspended) fm[FM_SUSPENDED] = true;
		else delete fm[FM_SUSPENDED];
	});
}

export interface UnenrollOptions {
	/**
	 * 指定したら、書く時点の study-deck がこの名前（前後の空白を除いて一致。大文字と小文字は区別する）の
	 * ときだけ外す（#25 のデッキの削除）。処理の途中でほかのデッキに変わったノートを外さないため
	 */
	onlyDeck?: string;
}

/**
 * frontmatter から study-deck・study-stage・study-next・study-history・study-suspended を消す。
 * 消したら true。onlyDeck が合わなければ何も変えずに false。ほかのキーは触らない。
 * Obsidian の API を呼ばない純粋な処理なので、プレーンなオブジェクトでテストできる
 */
export function applyUnenroll(fm: Record<string, unknown>, options: UnenrollOptions = {}): boolean {
	if (options.onlyDeck !== undefined) {
		const deck = fm[FM_DECK];
		if (typeof deck !== 'string' || deck.trim() !== options.onlyDeck) return false;
	}
	delete fm[FM_DECK];
	delete fm[FM_STAGE];
	delete fm[FM_NEXT];
	delete fm[FM_HISTORY];
	delete fm[FM_SUSPENDED];
	return true;
}

/**
 * 復習対象から外す。外したら true、onlyDeck が合わず何もしなかったら false（ファイルは書き戻さない）。
 * 判定は processFrontMatter が読み直した最新の値で行う。onWritten は外したときだけ呼ぶ
 */
export async function unenrollNote(
	app: App,
	filePath: string,
	onWritten?: OnWritten,
	options: UnenrollOptions = {},
): Promise<boolean> {
	try {
		await updateFrontMatter(
			app,
			filePath,
			(fm) => {
				if (!applyUnenroll(fm, options)) throw new SkipWrite();
			},
			onWritten,
		);
	} catch (error) {
		if (error instanceof SkipWrite) return false;
		throw error;
	}
	return true;
}

/** 所属デッキが直前総ざらいの期間中で、送れなかった */
export class PostponeInSprintError extends Error {
	constructor(readonly deck: string) {
		super(`${deck} は直前総ざらいの期間中です`);
		this.name = 'PostponeInSprintError';
	}
}

/**
 * frontmatter の study-next を「明日に送る」の新しい日付にし、その日付を返す。
 * Obsidian の API を呼ばない純粋な処理。stage と履歴には触れない。
 * study-next が不正な形式なら未設定として扱い、正しい形式で書き直す。
 * @param inSprint デッキ名が直前総ざらいの期間中か。frontmatter から読んだ最新のデッキ名で呼ばれる
 *   （画面の描画のあとに study-deck が変わっても、書き込むノートの今のデッキで判定するため）
 * @throws 復習対象でない（study-deck がない）とき、直前総ざらいの期間中
 *   （PostponeInSprintError）のとき。どちらも fm は変更しない
 */
export function applyPostpone(
	fm: Record<string, unknown>,
	today: string,
	inSprint: (deckName: string) => boolean,
): string {
	const deckRaw = fm[FM_DECK];
	if (typeof deckRaw !== 'string' || deckRaw.trim() === '') {
		throw new Error(NOT_ENROLLED_MESSAGE);
	}
	const deck = deckRaw.trim();
	if (inSprint(deck)) throw new PostponeInSprintError(deck);
	const current: unknown = fm[FM_NEXT];
	const next = postponeTarget(isISODate(current) ? current : null, today);
	fm[FM_NEXT] = next;
	return next;
}

// 次回復習日だけを手で動かす（「今日はもう時間がない」を素直に扱うため）。
// stage と履歴には触れないので、間隔の進み方には影響しない。新しい予定日を返す。
// 基準の予定日は、画面に出ていた値（インデックスのキャッシュ）ではなく、processFrontMatter が
// ファイルから読み直した値を使う。直前の採点で決めた次回日を、古い予定日からの計算で
// 上書きしないため。直前総ざらいの判定も同じ frontmatter のデッキ名で行い、期間中なら
// 書き込まずに PostponeInSprintError を投げる。today は inSprint の判定に使う日付と同じものを
// 渡す（日付の変わり目で、判定と計算の日付がずれないように）。
export async function postponeNote(
	app: App,
	filePath: string,
	today: string,
	inSprint: (deckName: string) => boolean,
	onWritten?: OnWritten,
): Promise<string> {
	const holder: { next?: string } = {};
	await updateFrontMatter(
		app,
		filePath,
		(fm) => {
			holder.next = applyPostpone(fm, today, inSprint);
		},
		onWritten,
	);
	if (holder.next === undefined) throw new Error('新しい予定日を取得できませんでした');
	return holder.next;
}
