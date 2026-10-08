import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type StudyCurvePlugin from '../main';
import { formatShort, todayISO } from './dateUtils';
import { planDeckRename } from './deckChange';
import {
	DEFAULT_NOTE_TEMPLATE,
	DEFAULT_NOTE_TITLE,
	renderTemplate,
	sanitizeFileName,
	uniquePath,
} from './noteFile';
import { isSprintDeck } from './reviewQueue';
import { initialNextDate, parseIntervals } from './schedule';
import {
	countNotesByDeck,
	findDeck,
	readStudyNote,
	studyNoteFromFrontmatter,
	studyStateKey,
} from './studyIndex';
import {
	GradeResult,
	OnWritten,
	PostponeInSprintError,
	enrollNote,
	gradeNote,
	postponeNote,
	renameDeckInNote,
	unenrollNote,
} from './studyMutator';
import { DeckConfig, Grade, StudyNote } from './types';

// 新しく足す UI の文言（#15 の多言語化で移しやすいように先頭にまとめる）
const TEXT = {
	graded: (name: string, date: string, clamped: boolean) =>
		`${name}：次回 ${date}${clamped ? '（試験日に合わせて前倒し）' : ''}`,
	gradeFailed: (reason: string) => `復習の記録に失敗しました：${reason}`,
	bodyFailed: (name: string, reason: string) =>
		`${name}：復習は記録しましたが、チェックを外せませんでした：${reason}`,
	postponed: (name: string, date: string) => `${name} を ${date} に送りました`,
	postponeInSprint: (deck: string) => `${deck} は直前総ざらいの期間中なので、送れません`,
	postponeFailed: (reason: string) => `予定の変更に失敗しました：${reason}`,
	unenrolled: (name: string) => `${name} を復習対象から外しました`,
	unenrollFailed: (reason: string) => `復習対象から外すのに失敗しました：${reason}`,
	unenrollBusy: (name: string) =>
		`${name} は採点などの処理中なので、復習対象から外しませんでした。少し待ってからもう一度実行してください`,
	enrolling: (done: number, total: number, deck: string) =>
		`登録中… ${done} / ${total}（${deck}）`,
	enrolled: (count: number, deck: string) => `${count} 件を「${deck}」に登録しました`,
	enrollSkipped: (count: number) => `（登録済みだった ${count} 件はそのまま）`,
	enrollBusySkipped: (count: number) =>
		`ほかの操作の処理中だった ${count} 件は登録していません。終わってからもう一度登録してください`,
	enrollFailed: (count: number, firstPath: string) =>
		`${count} 件は登録に失敗しました：${firstPath}${count >= 2 ? ` ほか ${count - 1} 件` : ''}`,
	// まとめての処理（一括登録、#22 の名前の変更、#25 の解除）の最中。どの処理の最中でも同じ文言にする
	bulkBusy: 'ほかのまとめての処理が終わるまでお待ちください',
	stillBusy: 'ほかの操作で書き換え中でした',
	// デッキの名前の変更（#22）
	renaming: (done: number, total: number, from: string, to: string) =>
		`書き換え中… ${done} / ${total}（${from} → ${to}）`,
	renamed: (count: number, to: string) => `${count} 件のノートのデッキを「${to}」に書き換えました`,
	renameFailed: (count: number, firstPath: string) =>
		`${count} 件は書き換えに失敗しました：${firstPath}${count >= 2 ? ` ほか ${count - 1} 件` : ''}`,
	renameFailedLog: (path: string, error: string) =>
		`Study Curve: ${path} のデッキの書き換えに失敗しました：${error}`,
	deckChangeBlocked:
		'今は設定を保存できないため、デッキを変更しませんでした（プラグインが古いか、設定を読み直しています）。',
	// 名前の変更（#22）と削除の解除（#25）で、書く時点でほかのデッキになっていたノート
	deckChangedSkipped: (count: number) => `（デッキが変わっていた ${count} 件はそのまま）`,
	// デッキの削除（#25）
	unnamedDeck: '（名前なし）',
	deckRemoved: (name: string) => `デッキ「${name}」を設定から削除しました`,
	removing: (done: number, total: number, name: string) =>
		`復習対象から外しています… ${done} / ${total}（${name}）`,
	removedNotes: (count: number) => `${count} 件を復習対象から外しました`,
	removeFailed: (count: number, firstPath: string) =>
		`${count} 件は外せませんでした：${firstPath}${count >= 2 ? ` ほか ${count - 1} 件` : ''}`,
	removeFailedLog: (path: string, error: string) =>
		`Study Curve: ${path} を復習対象から外せませんでした：${error}`,
	removeBlocked:
		'今は設定を保存できないため、デッキを削除しませんでした（プラグインが古いか、設定を読み直しています）。',
	removeSaveFailed: (reason: string) => `デッキの削除を保存できませんでした：${reason}`,
	addDecksFailed: (reason: string) => `デッキの設定の保存に失敗しました：${reason}`,
	noteCreated: (name: string, deck: string, firstDate: string) =>
		`「${name}」を作成しました（${deck}・初回 ${firstDate}）`,
	noteBusy:
		'ほかの操作で処理中でした。作成したノートで、コマンド「このノートを復習対象に登録」から登録し直してください',
	noteEnrollFailed: (reason: string) =>
		`ノートは作成しましたが、復習対象への登録に失敗しました：${reason}`,
	templateMissing: (path: string) =>
		`テンプレート「${path}」が見つからないため、内蔵の型で作成しました`,
	templateUnreadable: (path: string, reason: string) =>
		`テンプレート「${path}」を読めないため、内蔵の型で作成しました：${reason}`,
	folderBlockedByFile: (path: string) =>
		`「${path}」は同じ名前のファイルがあるため、フォルダを作れません`,
	unsafeFolder: (folder: string) => `フォルダ「${folder}」には . や .. を使えません`,
};

/** まとめての処理（一括登録、#22 の名前の変更、#25 の解除）の結果 */
export interface BulkResult {
	succeeded: number;
	/** 書く時点で対象でなくなっていた（登録済みだった、ほかのデッキになっていた）ため、上書きせずに飛ばした件数 */
	skipped: number;
	/** 別の操作（採点・解除など）でそのノートを書き換え中だったため、書かなかった件数（onBusy: 'skip' のとき） */
	busy: number;
	failed: { path: string; error: string }[];
}
/** #21 の名前を残す */
export type EnrollManyResult = BulkResult;

interface BulkJob {
	files: TFile[];
	/** 進み具合の通知の文言 */
	progress: (done: number, total: number) => string;
	/** 1件を書く。書いたら true、書く時点で対象外だったら false（書き戻さない） */
	write: (filePath: string, onWritten: OnWritten) => Promise<boolean>;
	/**
	 * ほかの操作でそのノートを書き換え中だったとき。skip：飛ばして busy に数える（一括登録）／
	 * retry：最後にもう一度だけ試し、まだなら失敗に数える（名前の変更、#25 の解除。飛ばすとノートが取り残される）
	 */
	onBusy: 'skip' | 'retry';
}

/** これより多い件数をまとめて処理するときは、消えない通知で進み具合を出す */
export const BULK_PROGRESS_THRESHOLD = 10;
/** #21 の名前を残す（テストが使っている） */
export const ENROLL_PROGRESS_THRESHOLD = BULK_PROGRESS_THRESHOLD;
/** onBusy: 'retry' で、もう一度試す前に待つ時間 */
export const BULK_RETRY_DELAY_MS = 1000;

/**
 * まとめての処理で失敗した（または処理中で書かなかった）ノートがあったときの結果の通知と、
 * 設定を保存できないために断ったときの通知を出しておく時間
 */
const LONG_NOTICE_MS = 10_000;

/**
 * 書き込んだ直後の状態を、metadataCache に反映されなくても使い続ける上限。
 * 反映は通常すぐだが、遅い端末でも十分な長さにする。これを過ぎると、手で study-* を書き換えた
 * 場合などに、書き込んだ状態をいつまでも優先しないようにキャッシュの値に戻す
 */
export const WRITTEN_STATE_TTL_MS = 30_000;

/**
 * updateDeck の結果。missing：対象のデッキが設定になかった（同期で読み直された、ほかで削除された）／
 * busy：ほかのまとめての処理の最中で、名前の変更（ノートの書き換え）を始められない。設定も変えていない／
 * blocked：設定を保存できない（新しい版の設定を読んだ、読み直しの最中。#27）ので、何も変えていない
 */
export type DeckUpdateResult = 'saved' | 'missing' | 'busy' | 'blocked';

/**
 * removeDeck の結果（#25）。missing：対象のデッキが設定になかった／busy：ほかのまとめての処理の最中／
 * blocked：設定を保存できない（#27）。busy・blocked では、設定もノートも変えていない
 */
export type DeckRemoveResult = 'removed' | 'missing' | 'busy' | 'blocked';

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 設定に入れるデッキの複製（呼び出し側の値と共有しない） */
function copyDeck(deck: DeckConfig): DeckConfig {
	return { name: deck.name, folder: deck.folder, examDate: deck.examDate };
}

/**
 * 設定「復習ノートのテンプレート」のパスからファイルを探す。.md を省いた書き方も受け付ける。
 * 見つからなければ null（設定画面の警告と、ノートの作成で同じ判定を使う）
 */
export function findNoteTemplate(app: App, rawPath: string): TFile | null {
	const path = rawPath.trim();
	if (path === '') return null;
	const file = app.vault.getFileByPath(normalizePath(path));
	if (file || /\.md$/i.test(path)) return file;
	return app.vault.getFileByPath(normalizePath(`${path}.md`));
}

// ノートを書き換える操作の入り口。ボード、study-today ブロック、コマンドのどこから
// 呼んでも、同じ処理・同じ通知になるようにここに集める。
export class StudyActions {
	/** 書き換え中のノートのパス。grade・postpone・unenroll で共有する */
	private readonly busy = new Set<string>();
	/**
	 * 処理を終えて、描き直しを待っているノート。描き直しが始まるまで処理中として扱う。
	 * 描き直しは間引きのため少し遅れるので、その間に古い行を押し直して二重に記録しないようにする
	 */
	private readonly settling = new Set<string>();
	/**
	 * 書き込んだ直後の復習の状態（解除したなら null）。metadataCache の中身が同じになるまでは、
	 * インデックスはキャッシュではなくこちらを使う。反映を変更の通知の届いた順番や時間で推測すると、
	 * 無関係な変更や遅い通知でキャッシュの古い状態が画面に戻り、押し直しで二重に記録されるため。
	 * stale は、キャッシュに残っていてもおかしくない書き込む前の状態（書き込む前のファイルの状態と、
	 * 処理を始めた時点のキャッシュの状態。直前の別の書き込みがまだ反映されていなければ両者は違う）。
	 * キャッシュがこのどれでもなく、
	 * 書き込んだ状態とも違うなら、ほかの書き込み（休止のコマンド、手での編集など）がファイルを
	 * 読み直して書いた後なので、書き込んだ状態は捨ててキャッシュを使う
	 */
	private readonly written = new Map<
		string,
		{ note: StudyNote | null; key: string; stale: Set<string>; timer: number }
	>();

	/**
	 * まとめての登録（1件ずつの登録も含む）の処理中か。登録するたびにボードが描き直されるので、
	 * 処理中の状態はボードではなくここに持つ
	 */
	private bulkRunning = false;

	constructor(private readonly plugin: StudyCurvePlugin) {}

	/**
	 * 採点・送り・解除の処理中か（処理を終えて描き直しを待つ間を含む）。
	 * UI はこれでボタンを無効にする
	 */
	isBusy(filePath: string): boolean {
		return this.busy.has(filePath) || this.settling.has(filePath);
	}

	/**
	 * インデックスを作るときに、ノートごとに呼ぶ。書き込み直後でキャッシュがまだ古いノートは、
	 * 書き込んだ状態を返す。キャッシュに反映済み、または書き込んでいないノートは undefined
	 * （キャッシュの値をそのまま使う）。反映を確かめたら、書き込んだ状態は捨てる
	 */
	stateFor(filePath: string, fromCache: StudyNote | null): StudyNote | null | undefined {
		const entry = this.written.get(filePath);
		if (!entry) return undefined;
		const cacheKey = studyStateKey(fromCache);
		// キャッシュがまだ書き込む前の状態なら、書き込んだ状態を使う
		if (cacheKey !== entry.key && entry.stale.has(cacheKey)) return entry.note;
		// 反映済み、またはほかの書き込みの後の状態になった
		window.clearTimeout(entry.timer);
		this.written.delete(filePath);
		return undefined;
	}

	/** まとめての登録の処理中か。ボードは描き直しのたびにこれを見て登録のボタンを無効にする */
	isBulkRunning(): boolean {
		return this.bulkRunning;
	}

	/** 描き直しの直前にプラグインが呼ぶ。描き直しを待っていたノートの処理中を解く */
	viewsRefreshing(): void {
		this.settling.clear();
	}

	/** プラグインの無効化時に、書き込んだ状態のタイマーを止める */
	dispose(): void {
		for (const { timer } of this.written.values()) window.clearTimeout(timer);
		this.written.clear();
		this.settling.clear();
	}

	/**
	 * 同じノートへの書き換えを同時に1つだけにする。処理中なら run を呼ばずに null を返す。
	 * run が例外を投げても、処理中の印は必ず外す。
	 *
	 * 書き込んだら、その状態をインデックスに使わせ（キャッシュの反映を待たない）、成功・失敗に
	 * かかわらずインデックスを作り直して描き直す。描き直すまでは処理中のまま（settling）にする。
	 */
	private async exclusive<T>(
		filePath: string,
		run: (onWritten: OnWritten) => Promise<T>,
	): Promise<T | null> {
		if (this.isBusy(filePath)) return null;
		this.busy.add(filePath);
		// 処理を始めた時点でキャッシュが見せている状態（画面に出ていた状態）
		const shownKey = this.cachedStateKey(filePath);
		try {
			return await run((before, after) => this.remember(filePath, before, after, shownKey));
		} finally {
			this.busy.delete(filePath);
			this.settling.add(filePath);
			this.plugin.invalidateIndex();
		}
	}

	private cachedStateKey(filePath: string): string | null {
		const { app } = this.plugin;
		const file = app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile ? studyStateKey(readStudyNote(app, file)) : null;
	}

	private remember(
		filePath: string,
		before: Record<string, unknown>,
		after: Record<string, unknown>,
		shownKey: string | null,
	): void {
		const name = basenameOf(filePath);
		const previous = this.written.get(filePath);
		if (previous) window.clearTimeout(previous.timer);
		// 続けて書き込んだときは、前の書き込みの前後の状態もまだキャッシュに残りうる
		const stale = new Set(previous ? [...previous.stale, previous.key] : []);
		stale.add(studyStateKey(studyNoteFromFrontmatter(filePath, name, before)));
		if (shownKey !== null) stale.add(shownKey);
		const note = studyNoteFromFrontmatter(filePath, name, after);
		const timer = window.setTimeout(() => {
			this.written.delete(filePath);
			this.plugin.invalidateIndex();
		}, WRITTEN_STATE_TTL_MS);
		this.written.set(filePath, { note, key: studyStateKey(note), stale, timer });
	}

	/**
	 * 採点する。同じノートを処理中なら何もせず null を返す（通知も出さない）。
	 * 成功・失敗の通知はここで出す。null は「記録していない」（処理中で無視、または失敗）。
	 */
	async grade(filePath: string, grade: Grade): Promise<GradeResult | null> {
		const { settings } = this.plugin;
		try {
			const result = await this.exclusive(filePath, (onWritten) =>
				gradeNote(
					this.plugin.app,
					filePath,
					grade,
					{
						intervals: parseIntervals(settings.intervalsRaw),
						examDateFor: (deck) => findDeck(deck, settings.decks)?.examDate ?? null,
						// 見出しの文字列が空なら、ON でも何も外さない（ファイルを読みにいかない）
						checkSection:
							settings.clearChecksOnGrade && settings.checkSectionHeading.trim() !== ''
								? settings.checkSectionHeading
								: null,
					},
					onWritten,
				),
			);
			if (result) {
				new Notice(
					TEXT.graded(basenameOf(filePath), formatShort(result.nextDate), result.clampedByExam),
				);
				if (result.bodyError) {
					new Notice(TEXT.bodyFailed(basenameOf(filePath), result.bodyError.message));
				}
			}
			return result;
		} catch (error) {
			new Notice(TEXT.gradeFailed(errorMessage(error)));
			return null;
		}
	}

	/**
	 * 明日に送る。新しい予定日（予定日と今日のうち遅いほうの翌日）を返す。
	 * 直前総ざらい中のデッキなら送らずに通知し、null（UI はボタンを出さないので、念のための防御。
	 * 描画のあとに試験日や study-deck を変えた場合などに届く）。判定は画面の note.deck ではなく、
	 * 書き込むときに frontmatter から読んだ最新のデッキ名で行う。
	 * 処理中なら何もせず null（通知も出さない）。
	 * 成功・失敗の通知はここで出す。
	 * 採点と同じノートごとの排他を通す（送りが採点と並行して動き、採点で決めた次回日を
	 * 古い予定日からの計算で上書きしないように）。
	 */
	async postpone(note: StudyNote): Promise<string | null> {
		const { settings } = this.plugin;
		// 直前総ざらいの判定と新しい予定日の計算で、同じ「今日」を使う
		const today = todayISO();
		const inSprint = (deckName: string) =>
			isSprintDeck(findDeck(deckName, settings.decks), today, settings.finalSprintDays);
		try {
			const next = await this.exclusive(note.filePath, (onWritten) =>
				postponeNote(this.plugin.app, note.filePath, today, inSprint, onWritten),
			);
			if (next) new Notice(TEXT.postponed(note.basename, formatShort(next)));
			return next;
		} catch (error) {
			new Notice(
				error instanceof PostponeInSprintError
					? TEXT.postponeInSprint(error.deck)
					: TEXT.postponeFailed(errorMessage(error)),
			);
			return null;
		}
	}

	/**
	 * 復習対象から外す（確認ダイアログは呼び出し側で出す）。成功で true。
	 * 外した・処理中で外さなかった・失敗した、の通知はここで出す（#24。呼び出し側が false を見て通知すると、
	 * 失敗の通知を出し済みの例外と処理中を区別できず、通知が重なるため）
	 */
	async unenroll(filePath: string): Promise<boolean> {
		try {
			const done = await this.exclusive(filePath, async (onWritten) => {
				await unenrollNote(this.plugin.app, filePath, onWritten);
				return true;
			});
			// done が null なら、ほかの操作でそのノートを書き換え中だった
			new Notice(
				done ? TEXT.unenrolled(basenameOf(filePath)) : TEXT.unenrollBusy(basenameOf(filePath)),
			);
			return done ?? false;
		} catch (error) {
			new Notice(TEXT.unenrollFailed(errorMessage(error)));
			return false;
		}
	}

	/**
	 * files を上から順に1件ずつ登録する。ほかのまとめての処理（名前の変更などを含む）の最中なら、何もせず通知だけ出して
	 * null を返す。10件より多ければ進み具合の通知を出し、最後に結果を通知する。
	 * today は初回の復習日の基準日。確認ダイアログに出した日付と同じものを渡す（省略したら
	 * 始めた時点の今日）。途中で日付をまたいでも、すべてのノートを同じ日付で登録する。
	 *
	 * 1件ごとに、採点などと同じノートごとの排他（exclusive）を通す。書き込んだ状態を
	 * metadataCache に反映されるまでインデックスに使わせ（登録したノートが、古いキャッシュで
	 * 未登録の一覧に戻ってこない）、描き直すまでは処理中にする（古い行の押し直しで二重に
	 * 書き込まない）。そのノートを別の操作で書き換え中なら、上書きせずに飛ばす（busy に数える）。
	 *
	 * 登録済みかの判定は、metadataCache ではなく enrollNote がファイルから読み直した frontmatter で
	 * 行う。解除の直後などはキャッシュに古い study-deck が残り、未登録のノートを登録済みと
	 * 誤って飛ばすため。登録済みなら、enrollNote はファイルを書き戻さない。
	 */
	async enrollMany(
		files: TFile[],
		deck: DeckConfig,
		today: string = todayISO(),
	): Promise<EnrollManyResult | null> {
		if (!this.beginBulk()) return null;
		const { app, settings } = this.plugin;
		// 確定した時点のデッキ名と試験日で最後まで登録する（途中で設定を変えても混ざらない）
		const deckName = deck.name;
		const examDate = deck.examDate;
		const intervals = parseIntervals(settings.intervalsRaw);
		const result = await this.runBulk({
			files,
			progress: (done, total) => TEXT.enrolling(done, total, deckName),
			write: (filePath, onWritten) =>
				enrollNote(
					app,
					filePath,
					deckName,
					intervals,
					examDate,
					{ skipIfEnrolled: true, today },
					onWritten,
				),
			// 書き換え中のノートは、その操作で登録済みか解除されたところなので、上書きせずに飛ばす
			onBusy: 'skip',
		});
		this.notifyEnrolled(result, deckName);
		return result;
	}

	/**
	 * まとめての処理（一括登録、#22 の名前の変更、#25 の解除）の占有を取る。
	 * ほかのまとめての処理の最中なら、通知を出して false（同じノートを2つの処理が交互に書かないように）
	 */
	private beginBulk(): boolean {
		if (this.bulkRunning) {
			new Notice(TEXT.bulkBusy);
			return false;
		}
		this.bulkRunning = true;
		return true;
	}

	/** 占有を外す。runBulk が最後に呼ぶ。runBulk の前に失敗したとき（設定の保存の失敗など）は呼び出し側が呼ぶ */
	private endBulk(): void {
		this.bulkRunning = false;
	}

	/**
	 * beginBulk で占有を取ったあとに呼ぶ。files を上から順に1件ずつ、採点などと同じノートごとの排他
	 * （exclusive）を通して write で書く。書き込んだ状態は metadataCache に反映されるまでインデックスに使われ、
	 * 描き直すまでは処理中になる。1件の失敗では止めない。件数が多ければ進み具合の通知を出す。
	 * 最後に（例外でも）進み具合の通知を閉じ、占有を外す。結果の通知は呼び出し側で出す
	 */
	private async runBulk(job: BulkJob): Promise<BulkResult> {
		const total = job.files.length;
		const result: BulkResult = { succeeded: 0, skipped: 0, busy: 0, failed: [] };
		const progress =
			total > BULK_PROGRESS_THRESHOLD ? new Notice(job.progress(0, total), 0) : null;
		const retry: TFile[] = [];
		try {
			for (const [i, file] of job.files.entries()) {
				if (await this.writeInBulk(file, job, result)) {
					if (job.onBusy === 'retry') retry.push(file);
					else result.busy++;
				}
				progress?.setMessage(job.progress(i + 1, total));
			}
			if (retry.length > 0) {
				// 採点などは描き直し（300ms で間引く）までノートを処理中にするので、それより長く待つ
				await new Promise<void>((resolve) => window.setTimeout(resolve, BULK_RETRY_DELAY_MS));
				for (const file of retry) {
					if (await this.writeInBulk(file, job, result)) {
						result.failed.push({ path: file.path, error: TEXT.stillBusy });
					}
				}
			}
		} finally {
			progress?.hide();
			this.endBulk();
		}
		return result;
	}

	/** まとめての処理の1件を書き、結果に数える。ほかの操作で書き換え中だったら数えずに true */
	private async writeInBulk(file: TFile, job: BulkJob, result: BulkResult): Promise<boolean> {
		// 処理する時点のパス（途中で名前が変わっても TFile.path は追従する）
		const filePath = file.path;
		try {
			const written = await this.exclusive(filePath, (onWritten) => job.write(filePath, onWritten));
			if (written === null) return true;
			if (written) result.succeeded++;
			else result.skipped++;
		} catch (error) {
			result.failed.push({ path: filePath, error: errorMessage(error) });
		}
		return false;
	}

	/**
	 * デッキを設定の末尾に追加して保存する。名前が設定にあるもの（渡した中での重複を含む）は
	 * 追加しない。追加した件数を返す（0件なら保存しない）。追加するデッキは複製して入れる
	 * （呼び出し側の値と共有しない）。
	 * 保存に失敗したら、追加したデッキを設定から外して失敗を通知し、null を返す（0 と分ける。
	 * 呼び出し側は、入力を残して押し直せるようにしたり、ノートの登録をやめたりする）。成功の通知は
	 * 呼び出し側で出す（場面ごとに文言が違うため）。保存すると描き直しが通知される（saveSettings）
	 */
	async addDecks(decks: DeckConfig[]): Promise<number | null> {
		const { settings } = this.plugin;
		const added: DeckConfig[] = [];
		for (const deck of decks) {
			if (findDeck(deck.name, settings.decks) || findDeck(deck.name, added)) continue;
			added.push(copyDeck(deck));
		}
		if (added.length === 0) return 0;
		try {
			// 足すのは saveDeckChange の中の最初の await より前なので、続けて呼ばれても同じ名前を2回足さない
			await this.saveDeckChange(
				(list) => {
					list.push(...added);
				},
				(list) => {
					for (const deck of added) {
						const index = list.indexOf(deck);
						if (index !== -1) list.splice(index, 1);
					}
				},
			);
			return added.length;
		} catch (error) {
			new Notice(TEXT.addDecksFailed(errorMessage(error)));
			return null;
		}
	}

	/**
	 * 設定のデッキ target を next に置き換えて保存する（#26 の編集のダイアログ）。target は参照で探す
	 * （同じ名前のデッキが複数あっても取り違えない）。見つからなければ（同期で設定が読み直された、
	 * ほかで削除された）何もせず 'missing'。next は複製して入れる（呼び出し側の値と共有しない。
	 * target の知らないキーは残す）。
	 * 保存が例外なら、この変更だけを戻してから例外を投げる（ダイアログが理由を出し、押し直せる）。
	 *
	 * 名前を変えたら、古い名前のノートの study-deck も新しい名前に書き換える（#22）。設定を先に保存し、
	 * ノートはその後にまとめての処理で書き換える（途中で失敗しても、設定は意図どおりの名前で、取り残された
	 * ノートは古い名前のカードとしてボードに見える）。ノートの書き換えは待たずに返し、進み具合と結果は通知で出す。
	 * 設定を保存できないとき（#27）は、ノートだけが書き換わらないように何も変えず 'blocked'。
	 * 名前を変えるときは、ほかのまとめての処理の最中なら何も変えず 'busy'（書き換えるノートが0件でも断る。
	 * A → B の書き換えの途中で B → C を確定すると、先の処理がノートを設定に無い B に書き換えるため）
	 */
	async updateDeck(target: DeckConfig, next: DeckConfig): Promise<DeckUpdateResult> {
		if (this.plugin.isSettingsSaveBlocked()) {
			new Notice(TEXT.deckChangeBlocked, LONG_NOTICE_MS);
			return 'blocked';
		}
		const { settings } = this.plugin;
		const index = settings.decks.indexOf(target);
		if (index === -1) return 'missing';
		const renaming = next.name !== target.name;
		// 占有は設定を保存する前に取る（保存してから取れないと、設定だけ変わってノートが取り残される）
		if (renaming && !this.beginBulk()) return 'busy';
		const plan = planDeckRename({
			from: target.name,
			to: next.name,
			otherDeckNames: settings.decks.filter((deck) => deck !== target).map((deck) => deck.name),
			noteCounts: countNotesByDeck(this.plugin.getIndex().notes),
		});
		// 知らないキー（新しい版のプラグインが書いたものなど）は残す（#27 の読み込みと同じ）
		const copy: DeckConfig = { ...target, ...copyDeck(next) };
		try {
			await this.saveDeckChange(
				(list) => {
					list[index] = copy;
				},
				(list) => {
					// 保存を待つ間にほかのデッキが足されたり消されたりしていても、入れた複製の位置に戻す
					const at = list.indexOf(copy);
					if (at !== -1) list[at] = target;
				},
			);
		} catch (error) {
			if (renaming) this.endBulk();
			throw error;
		}
		if (!renaming) return 'saved';
		// 保存の前に数えた件数では決めない（保存を待つ間に同期などで古い名前のノートが増えていても取り残さない）。
		// 書き換えないのは、同じ名前のデッキがほかにもある（ノートはそちらのデッキのもの）ときだけ
		const files = plan.sharedOldName ? [] : this.notesOfDeck(plan.from);
		if (files.length === 0) {
			this.endBulk();
			return 'saved';
		}
		const { app } = this.plugin;
		void this.runBulk({
			files,
			progress: (done, total) => TEXT.renaming(done, total, plan.from, plan.to),
			write: (filePath, onWritten) =>
				renameDeckInNote(app, filePath, plan.from, plan.to, onWritten),
			onBusy: 'retry',
		})
			.then((result) =>
				this.notifyBulkResult(result, {
					done: TEXT.renamed(result.succeeded, plan.to),
					failed: TEXT.renameFailed,
					log: TEXT.renameFailedLog,
				}),
			)
			.catch((error: unknown) => {
				// 1件ずつの失敗は runBulk が数えるので、ここに来るのは想定外の誤り。占有は runBulk が外している
				console.error('Study Curve: デッキの名前の変更に失敗しました', error);
			});
		return 'saved';
	}

	/**
	 * 設定からデッキ target（参照で探す）を消して保存する（#25）。notes が 'unenroll' なら、そのデッキ名のノートを
	 * 復習対象から外す（設定を保存した後に始めるだけで待たない。進み具合と結果は通知で出す）。書く時点で
	 * ほかのデッキになっていたノートは外さない。同じ名前のデッキが設定にもう1つあるときは、'unenroll' でも
	 * ノートに触れない（そのノートはもう1つのデッキのもの）。
	 * ほかのまとめての処理の最中なら、'keep' でも何もせず 'busy'（その処理が書いたノートを迷子にしないため）。
	 * 設定を保存できないとき（#27）は、'keep' でも何もせず 'blocked'（設定から消せないのにノートの履歴だけが消えたり、
	 * この起動の間だけ消えて再起動で戻ったりしないように）。
	 * 保存が例外なら、この削除だけを戻し、占有を外してから例外を投げる
	 */
	async removeDeck(target: DeckConfig, notes: 'keep' | 'unenroll'): Promise<DeckRemoveResult> {
		if (this.plugin.isSettingsSaveBlocked()) {
			new Notice(TEXT.removeBlocked, LONG_NOTICE_MS);
			return 'blocked';
		}
		const index = this.plugin.settings.decks.indexOf(target);
		if (index === -1) return 'missing';
		// 占有は設定を保存する前に取る（保存してから取れないと、設定だけ消えてノートが取り残される）
		if (!this.beginBulk()) return 'busy';
		const name = target.name;
		try {
			await this.saveDeckChange(
				(list) => {
					// 見つからないまま splice(-1, 1) すると末尾の別のデッキを消すので、必ず確かめる
					const at = list.indexOf(target);
					if (at !== -1) list.splice(at, 1);
				},
				(list) => {
					// 保存を待つ間にほかのデッキが足されていても消さない。元の位置（短くなっていれば末尾）に戻すだけ
					if (!list.includes(target)) list.splice(Math.min(index, list.length), 0, target);
				},
			);
		} catch (error) {
			// 確認のダイアログは閉じるだけなので、ここで知らせる（addDecks と同じ）。設定は消す前に戻っている
			new Notice(TEXT.removeSaveFailed(errorMessage(error)));
			this.endBulk();
			throw error;
		}
		new Notice(TEXT.deckRemoved(name.trim() === '' ? TEXT.unnamedDeck : name));
		const shared = this.plugin.settings.decks.some((deck) => deck.name === name);
		const files = notes === 'keep' || shared ? [] : this.notesOfDeck(name);
		if (files.length === 0) {
			this.endBulk();
			return 'removed';
		}
		const { app } = this.plugin;
		void this.runBulk({
			files,
			progress: (done, total) => TEXT.removing(done, total, name),
			write: (filePath, onWritten) => unenrollNote(app, filePath, onWritten, { onlyDeck: name }),
			// 飛ばすと、そのノートが設定に無いデッキ名のまま取り残される
			onBusy: 'retry',
		})
			.then((result) =>
				this.notifyBulkResult(result, {
					done: TEXT.removedNotes(result.succeeded),
					failed: TEXT.removeFailed,
					log: TEXT.removeFailedLog,
				}),
			)
			.catch((error: unknown) => {
				// 1件ずつの失敗は runBulk が数えるので、ここに来るのは想定外の誤り。占有は runBulk が外している
				console.error('Study Curve: デッキの削除でノートを外すのに失敗しました', error);
			});
		return 'removed';
	}

	/**
	 * settings.decks に apply で変更を加えて保存する（#26。#22 の名前の変更と #25 の削除も使う）。
	 * 保存が例外なら、同期で読み直されていない（settings.decks が同じ配列）ときだけ undo でその変更だけを戻し、
	 * もう一度だけ保存してから、最初の例外を投げる。配列を丸ごと戻さないのは、保存を待つ間にほかの操作が
	 * 足した・消したデッキ（その保存は成功しているかもしれない）まで消さないため
	 */
	private async saveDeckChange(
		apply: (decks: DeckConfig[]) => void,
		undo: (decks: DeckConfig[]) => void,
	): Promise<void> {
		const decks = this.plugin.settings.decks;
		apply(decks);
		try {
			await this.plugin.saveSettings();
		} catch (error) {
			// 同期で読み直されると this.plugin.settings そのものが新しいオブジェクトになるので、毎回たどり直す
			if (this.plugin.settings.decks === decks) {
				undo(decks);
				// 戻した設定をもう一度保存する。保存を待つ間に、ほかの設定の保存（設定画面のほかの欄など）が
				// 失敗した変更を含んだ設定をファイルに書いていても、ファイルも元に戻すため
				try {
					await this.plugin.saveSettings();
				} catch {
					// 書き直しも失敗したら、最初の例外だけを知らせる
				}
			}
			throw error;
		}
	}

	/**
	 * 復習ノートを作り、登録し、ファイルを返す（#10）。開くのは呼び出し側。
	 * 作成に失敗したら例外。作成した後の登録に失敗したときは、通知を出してファイルを返す
	 * （ノートは残っているので、コマンド「このノートを復習対象に登録」で登録し直せる。ボードの未登録の
	 * 欄はデッキにフォルダがあるときしか出ないので、案内はコマンドにする）。
	 * study-* は本文に書かず、作成の後に enrollNote（processFrontMatter）で書く。デッキ名に : や # が
	 * あっても YAML が壊れず、テンプレートの frontmatter も残したまま足せるため
	 */
	async createReviewNote(deck: DeckConfig, title: string): Promise<TFile> {
		const { app, settings } = this.plugin;
		const folder = this.resolveNoteFolder(deck);
		await this.ensureFolder(folder);
		// 名前を決めてから vault.create までのあいだに await を挟まない（そのあいだに同期などで
		// 同じ名前のファイルができて、作成に失敗しないように）ので、テンプレートは先に読む
		const { text, fallbackReason } = await this.loadTemplate();
		const base = sanitizeFileName(title) || DEFAULT_NOTE_TITLE;
		// macOS と Windows の標準のファイルシステムでは大文字と小文字だけ違う名前が同じファイルになり、
		// vault.create が失敗するので、大文字と小文字を区別せずに重複を避ける。比べるのは作るフォルダの中だけ
		const parent = folder === '' ? app.vault.getRoot() : app.vault.getFolderByPath(folder);
		const lowerPaths = new Set(parent?.children.map((child) => child.path.toLowerCase()) ?? []);
		const path = normalizePath(
			uniquePath(
				folder,
				base,
				'md',
				(candidate) =>
					app.vault.getAbstractFileByPath(candidate) !== null ||
					lowerPaths.has(candidate.toLowerCase()),
			),
		);
		const today = todayISO();
		const file = await app.vault.create(
			path,
			renderTemplate(text, { title: title.trim(), deck: deck.name, date: today }),
		);
		try {
			const intervals = parseIntervals(settings.intervalsRaw);
			// 採点などと同じ排他を通し、metadataCache に載る前からボードに登録済みとして出す
			const enrolled = await this.exclusive(file.path, (onWritten) =>
				enrollNote(
					app,
					file.path,
					deck.name,
					intervals,
					deck.examDate,
					{ today, resetHistory: true },
					onWritten,
				),
			);
			// 作ったばかりのパスが処理中になることはまずないが、登録していないのに「作成しました」と出さない
			if (enrolled === null) throw new Error(TEXT.noteBusy);
			const firstDate = formatShort(initialNextDate(intervals, today, deck.examDate));
			new Notice(TEXT.noteCreated(file.basename, deck.name, firstDate));
		} catch (error) {
			new Notice(TEXT.noteEnrollFailed(errorMessage(error)));
		}
		if (fallbackReason) new Notice(fallbackReason);
		return file;
	}

	/**
	 * ノートを作るフォルダ。デッキにフォルダがあればそこ、なければ Obsidian の「新規ノートの作成場所」。
	 * . や .. を含むフォルダは使わない（手で書き換えた設定などで、意図しない場所に作らないため）
	 */
	private resolveNoteFolder(deck: DeckConfig): string {
		const { app } = this.plugin;
		if (deck.folder.trim() !== '') {
			const folder = normalizePath(deck.folder);
			if (folder.split('/').some((part) => part === '.' || part === '..')) {
				throw new Error(TEXT.unsafeFolder(folder));
			}
			return folder;
		}
		const parent = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '');
		return parent.isRoot() ? '' : parent.path;
	}

	/** フォルダがなければ作る。createFolder が途中のフォルダまで作るかは API の説明にないので、1段ずつ作る */
	private async ensureFolder(path: string): Promise<void> {
		if (path === '') return;
		const { vault } = this.plugin.app;
		const parts = path.split('/');
		for (let i = 1; i <= parts.length; i++) {
			const prefix = parts.slice(0, i).join('/');
			const existing = vault.getAbstractFileByPath(prefix);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(TEXT.folderBlockedByFile(prefix));
			try {
				await vault.createFolder(prefix);
			} catch (error) {
				// 同期などで同時に作られて「すでにある」になったなら、そのまま続ける
				if (!(vault.getAbstractFileByPath(prefix) instanceof TFolder)) throw error;
			}
		}
	}

	/** 設定のテンプレートを読む。空なら内蔵の型。見つからない・読めないときは内蔵の型とその理由 */
	private async loadTemplate(): Promise<{ text: string; fallbackReason: string | null }> {
		const { app, settings } = this.plugin;
		const raw = settings.noteTemplatePath.trim();
		if (raw === '') return { text: DEFAULT_NOTE_TEMPLATE, fallbackReason: null };
		const file = findNoteTemplate(app, raw);
		if (!file) return { text: DEFAULT_NOTE_TEMPLATE, fallbackReason: TEXT.templateMissing(raw) };
		try {
			return { text: await app.vault.cachedRead(file), fallbackReason: null };
		} catch (error) {
			return {
				text: DEFAULT_NOTE_TEMPLATE,
				fallbackReason: TEXT.templateUnreadable(raw, errorMessage(error)),
			};
		}
	}

	/**
	 * デッキの名前の変更（#22）と、削除でノートを外す処理（#25）の結果の通知。
	 * 書く時点でほかのデッキになっていたノートの件数を添え、失敗があれば長めに出して開発者コンソールに全件を出す
	 */
	private notifyBulkResult(
		result: BulkResult,
		text: {
			done: string;
			failed: (count: number, firstPath: string) => string;
			log: (path: string, error: string) => string;
		},
	): void {
		let message = text.done;
		if (result.skipped > 0) message += TEXT.deckChangedSkipped(result.skipped);
		const [first] = result.failed;
		if (!first) {
			new Notice(message);
			return;
		}
		for (const { path, error } of result.failed) console.error(text.log(path, error));
		message += `\n${text.failed(result.failed.length, first.path)}`;
		new Notice(message, LONG_NOTICE_MS);
	}

	/**
	 * そのデッキ名のノート。保存の後に作り直したインデックス（書き込んだ直後の状態を含む）で選ぶ。
	 * キャッシュでは飛ばさない（直前の書き換えがまだ反映されていないことがある）。対象かどうかは、
	 * 書く時点のファイルの値で判定する（renameDeckInNote、unenrollNote の onlyDeck）
	 */
	private notesOfDeck(deckName: string): TFile[] {
		return this.plugin
			.getIndex()
			.notes.filter((note) => note.deck === deckName)
			.map((note) => this.plugin.app.vault.getFileByPath(note.filePath))
			.filter((file): file is TFile => file !== null);
	}

	private notifyEnrolled(result: EnrollManyResult, deckName: string): void {
		let message = TEXT.enrolled(result.succeeded, deckName);
		if (result.skipped > 0) message += TEXT.enrollSkipped(result.skipped);
		// 登録していないノートが残ったときは、気づけるように長めに出す
		if (result.busy > 0) message += `\n${TEXT.enrollBusySkipped(result.busy)}`;
		const [first] = result.failed;
		if (first) {
			for (const { path, error } of result.failed) {
				console.error(`Study Curve: ${path} の登録に失敗しました：${error}`);
			}
			message += `\n${TEXT.enrollFailed(result.failed.length, first.path)}`;
		}
		if (first || result.busy > 0) new Notice(message, LONG_NOTICE_MS);
		else new Notice(message);
	}
}

/** パスからノート名（拡張子なし）を取り出す。ファイルが消えていても通知を出せるように文字列で処理する */
function basenameOf(filePath: string): string {
	const name = filePath.slice(filePath.lastIndexOf('/') + 1);
	return name.replace(/\.md$/i, '');
}
