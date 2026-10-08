import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFile as VaultFile } from 'obsidian';
import type StudyCurvePlugin from '../src/main';
import {
	BULK_RETRY_DELAY_MS,
	ENROLL_PROGRESS_THRESHOLD,
	StudyActions,
	WRITTEN_STATE_TTL_MS,
} from '../src/studyCurve/actions';
import { buildStudyIndex } from '../src/studyCurve/studyCache';
import { studyNoteFromFrontmatter } from '../src/studyCurve/studyIndex';
import type { DeckConfig, StudyNote } from '../src/studyCurve/types';
import { Notice, TFile, noticeLog } from './obsidian-stub';

// StudyActions の非同期の経路（処理中の判定、競合時の無視、例外時のロック解除、
// 書き込んだ状態を metadataCache に反映されるまでインデックスに使う扱い）を、
// Obsidian の API の偽物で確かめる。

interface FakeNote {
	fm: Record<string, unknown>;
	body: string;
}

/** 呼ばれるまで止めておける Promise。書き込みの途中に別の操作を割り込ませるために使う */
function gate(): { wait: Promise<void>; open: () => void } {
	let open = () => {};
	const wait = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { wait, open };
}

class FakeVault {
	notes = new Map<string, FakeNote>();
	/** metadataCache の frontmatter。設定していないノートは、ファイルの今の中身を返す（反映済み） */
	cache = new Map<string, Record<string, unknown>>();
	/** processFrontMatter が実際にファイルを書いた回数 */
	writes = 0;
	/** 次の processFrontMatter を止めておく門 */
	nextGate: Promise<void> | null = null;
	/** Vault.process が本文を書いた回数 */
	bodyWrites = 0;
	/** 次の Vault.process のコールバックの直前に、本文に加える編集（読み込みのあとの編集や同期） */
	editBeforeProcess: ((body: string) => string) | null = null;
	failProcess = false;
	/** cachedRead が返す、古いキャッシュの本文。設定していないノートは今の本文を返す */
	cachedBody = new Map<string, string>();
	/** コールバックは走らせるが、その後の保存に失敗する */
	failSave = false;
	/** コールバックは走らせるが、その後の保存に失敗するノート（1件だけ失敗させる） */
	failSavePaths = new Set<string>();
	/** metadataCache にまだ frontmatter が載っていないノート（作った直後など） */
	noCache = new Set<string>();

	add(path: string, fm: Record<string, unknown>, body = ''): void {
		this.notes.set(path, { fm, body });
	}

	fm(path: string): Record<string, unknown> {
		return this.notes.get(path)!.fm;
	}

	private file(path: string): TFile {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
		return file;
	}

	app() {
		return {
			vault: {
				getAbstractFileByPath: (path: string) => {
					if (!this.notes.has(path)) return null;
					const file = new TFile();
					file.path = path;
					return file;
				},
				getFileByPath: (path: string) => (this.notes.has(path) ? this.file(path) : null),
				getMarkdownFiles: () => [...this.notes.keys()].map((path) => this.file(path)),
				read: async (file: TFile) => this.notes.get(file.path)!.body,
				cachedRead: async (file: TFile) =>
					this.cachedBody.get(file.path) ?? this.notes.get(file.path)!.body,
				// 本物と同じく、最新の本文をコールバックに渡し、その戻り値を書く
				process: async (file: TFile, fn: (data: string) => string) => {
					if (this.failProcess) throw new Error('書き込めません');
					const note = this.notes.get(file.path)!;
					const edit = this.editBeforeProcess;
					this.editBeforeProcess = null;
					if (edit) note.body = edit(note.body);
					note.body = fn(note.body);
					this.bodyWrites++;
					return note.body;
				},
			},
			metadataCache: {
				getFileCache: (file: TFile) => {
					if (this.noCache.has(file.path)) return null;
					const fm = this.cache.get(file.path) ?? this.notes.get(file.path)?.fm;
					return fm ? { frontmatter: structuredClone(fm) } : null;
				},
			},
			fileManager: {
				// 本物と同じく、コールバックが例外を投げたらファイルを書かずに投げ直す
				processFrontMatter: async (
					file: TFile,
					fn: (fm: Record<string, unknown>) => void,
				) => {
					const waitFor = this.nextGate;
					this.nextGate = null;
					if (waitFor) await waitFor;
					const note = this.notes.get(file.path);
					if (!note) throw new Error('ノートが見つかりません');
					const copy = structuredClone(note.fm);
					fn(copy);
					if (this.failSave || this.failSavePaths.has(file.path)) throw new Error('保存できません');
					note.fm = copy;
					this.writes++;
				},
			},
		};
	}
}

const A = 'deck/A.md';
const B = 'deck/B.md';

function enrolled(): Record<string, unknown> {
	return { 'study-deck': 'D', 'study-stage': 0, 'study-next': '2026-09-28', 'study-history': [] };
}

function studyNote(path: string, nextDate: string): StudyNote {
	return {
		filePath: path,
		basename: path.replace(/^.*\//, '').replace(/\.md$/, ''),
		deck: 'D',
		stage: 0,
		nextDate,
		history: [],
		suspended: false,
	};
}

/** metadataCache が、今のファイルの中身を読み終えた状態（反映済み）のノート */
function cached(path: string): ReturnType<typeof studyNoteFromFrontmatter> {
	return studyNoteFromFrontmatter(path, path.replace(/^.*\//, '').replace(/\.md$/, ''), vault.fm(path));
}

let vault: FakeVault;
let invalidateIndex: ReturnType<typeof vi.fn>;
let settings: {
	intervalsRaw: string;
	decks: never[];
	clearChecksOnGrade: boolean;
	checkSectionHeading: string;
};
let actions: StudyActions;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 8, 28, 9, 0, 0));
	// actions は window.setTimeout を使う。テストは Node なので window を globalThis にする
	vi.stubGlobal('window', globalThis);
	noticeLog.length = 0;
	vault = new FakeVault();
	vault.add(A, enrolled());
	vault.add(B, enrolled());
	invalidateIndex = vi.fn();
	settings = {
		intervalsRaw: '1, 3, 7',
		decks: [],
		clearChecksOnGrade: false,
		checkSectionHeading: '思い出せるか',
	};
	const plugin = { app: vault.app(), settings, invalidateIndex };
	actions = new StudyActions(plugin as unknown as StudyCurvePlugin);
});

afterEach(() => {
	actions.dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('StudyActions.grade', () => {
	it('同じノートへの同時の採点は1回だけ書き込む', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const first = actions.grade(A, 'good');
		const second = actions.grade(A, 'good');
		expect(actions.isBusy(A)).toBe(true);
		g.open();
		const [r1, r2] = await Promise.all([first, second]);
		expect(r1?.stage).toBe(1);
		expect(r2).toBeNull();
		expect(vault.writes).toBe(1);
		expect(vault.fm(A)['study-history']).toEqual(['2026-09-28 ok']);
		expect(vault.fm(A)['study-stage']).toBe(1);
		// 無視した要求は通知を出さない
		expect(noticeLog).toEqual(['A：次回 10/1(木)']);
	});

	it('別のノートは並行して採点できる', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const first = actions.grade(A, 'good');
		const second = actions.grade(B, 'again');
		g.open();
		const [r1, r2] = await Promise.all([first, second]);
		expect(r1?.stage).toBe(1);
		expect(r2?.stage).toBe(0);
		expect(vault.writes).toBe(2);
	});

	it('失敗したらロックを外し、失敗の通知を出して、描き直しを頼む', async () => {
		vault.add(A, { 'study-stage': 2 }); // study-deck がない
		expect(await actions.grade(A, 'good')).toBeNull();
		expect(vault.writes).toBe(0);
		expect(noticeLog).toEqual(['復習の記録に失敗しました：このノートは復習対象ではありません']);
		expect(invalidateIndex).toHaveBeenCalledTimes(1);
		// 書き込んでいないので、インデックスはキャッシュの値を使う
		expect(actions.stateFor(A, null)).toBeUndefined();

		// 描き直したあとはロックが残っていないので、直せば採点できる
		actions.viewsRefreshing();
		expect(actions.isBusy(A)).toBe(false);
		vault.add(A, enrolled());
		expect((await actions.grade(A, 'good'))?.stage).toBe(1);
	});

	it('ノートが見つからなければ失敗として通知する', async () => {
		expect(await actions.grade('deck/none.md', 'good')).toBeNull();
		actions.viewsRefreshing();
		expect(actions.isBusy('deck/none.md')).toBe(false);
		expect(noticeLog[0]).toBe('復習の記録に失敗しました：ノートが見つかりません：deck/none.md');
	});

	it('書き込んだあと、描き直すまでは処理中として扱い、押し直しを記録しない', async () => {
		await actions.grade(A, 'good');
		expect(invalidateIndex).toHaveBeenCalledTimes(1);
		expect(actions.isBusy(A)).toBe(true);
		expect(await actions.grade(A, 'good')).toBeNull();
		expect(vault.writes).toBe(1);

		// 描き直しが始まったら解く。描き直した行（書き込んだ状態）からの採点は、
		// 同じ日の2回目として記録する（仕様）
		actions.viewsRefreshing();
		expect(actions.isBusy(A)).toBe(false);
		expect((await actions.grade(A, 'good'))?.stage).toBe(2);
		expect(vault.writes).toBe(2);
	});

	it('キャッシュが古いあいだは、インデックスに書き込んだ状態を使う', async () => {
		const stale = cached(A);
		await actions.grade(A, 'good');
		const state = actions.stateFor(A, stale);
		expect(state?.stage).toBe(1);
		expect(state?.nextDate).toBe('2026-10-01');
		expect(state?.history).toEqual([{ date: '2026-09-28', grade: 'good' }]);
	});

	it('書き込みの途中や後に無関係な変更が届いても、キャッシュが書き込んだ内容になるまで書き込んだ状態を使う', async () => {
		const stale = cached(A);
		const g = gate();
		vault.nextGate = g.wait;
		const pending = actions.grade(A, 'good');
		// 書き込みの途中のインデックスの作り直し：まだ書き込んでいないのでキャッシュの値を使う
		// （行は処理中として無効に描かれる）
		expect(actions.stateFor(A, stale)).toBeUndefined();
		expect(actions.isBusy(A)).toBe(true);
		g.open();
		await pending;
		actions.viewsRefreshing();

		// 書き込みの後に、書き込む前の内容の変更の通知が届いても、書き込んだ状態を使い続ける
		expect(actions.stateFor(A, stale)?.nextDate).toBe('2026-10-01');
		expect(actions.stateFor(A, stale)?.nextDate).toBe('2026-10-01');

		// キャッシュが書き込んだ内容になったら、書き込んだ状態は捨てる
		expect(actions.stateFor(A, cached(A))).toBeUndefined();
		expect(actions.stateFor(A, stale)).toBeUndefined();
	});

	it('キャッシュへの反映が遅れても、時間で古い状態に戻さない（保険の上限まで）', async () => {
		const stale = cached(A);
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		vi.advanceTimersByTime(3000);
		expect(actions.stateFor(A, stale)?.nextDate).toBe('2026-10-01');
		expect(invalidateIndex).toHaveBeenCalledTimes(1);

		// 保険の上限を過ぎたら、書き込んだ状態を捨てて作り直す
		vi.advanceTimersByTime(WRITTEN_STATE_TTL_MS - 3000);
		expect(invalidateIndex).toHaveBeenCalledTimes(2);
		expect(actions.stateFor(A, stale)).toBeUndefined();
	});

	it('コールバックの後の保存に失敗したら、書き込んでいない状態をインデックスに使わない', async () => {
		const before = cached(A);
		vault.failSave = true;
		expect(await actions.grade(A, 'good')).toBeNull();
		expect(noticeLog).toEqual(['復習の記録に失敗しました：保存できません']);
		expect(vault.fm(A)['study-stage']).toBe(0);
		actions.viewsRefreshing();
		// 未採点のノートが今日の一覧から消えず、押し直せる
		expect(actions.stateFor(A, before)).toBeUndefined();
		expect(actions.isBusy(A)).toBe(false);
	});

	it('採点のあと、反映前にほかの書き込み（休止など）があれば、その状態のキャッシュを使う', async () => {
		const stale = cached(A);
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		expect(actions.stateFor(A, stale)?.suspended).toBe(false);
		// 休止のコマンドは StudyActions を通らず、ファイルを読み直して書く（採点の内容を含む）
		vault.fm(A)['study-suspended'] = true;
		expect(actions.stateFor(A, cached(A))?.suspended).toBeUndefined();
		expect(actions.stateFor(A, cached(A))).toBeUndefined();
		// 書き込んだ状態は捨てたので、古いキャッシュの通知が遅れて届いてもそのまま使う
		expect(actions.stateFor(A, stale)).toBeUndefined();
	});

	it('続けて書き込み、キャッシュが2つ前の状態のままでも、最後に書き込んだ状態を使う', async () => {
		const first = cached(A);
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		const second = cached(A);
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		expect(vault.fm(A)['study-stage']).toBe(2);
		expect(actions.stateFor(A, first)?.stage).toBe(2);
		expect(actions.stateFor(A, second)?.stage).toBe(2);
		expect(actions.stateFor(A, cached(A))).toBeUndefined();
	});

	it('直前の別の書き込みがキャッシュに反映される前に採点しても、書き込んだ状態を使い続ける', async () => {
		// 休止のコマンドなど、StudyActions を通らない書き込みが保存済みで、キャッシュはその前のまま
		const shown = cached(A);
		vault.cache.set(A, structuredClone(vault.fm(A)));
		vault.fm(A)['study-suspended'] = true;
		const between = cached(A);
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		// キャッシュが、画面に出ていた状態 → 別の書き込みの状態 と進むあいだは、書き込んだ状態を使う
		expect(actions.stateFor(A, shown)?.stage).toBe(1);
		expect(actions.stateFor(A, between)?.stage).toBe(1);
		// 採点まで反映されたら捨てる
		vault.cache.delete(A);
		expect(actions.stateFor(A, cached(A))).toBeUndefined();
	});

	it('ほかのノートの状態には影響しない', async () => {
		await actions.grade(A, 'good');
		expect(actions.stateFor(B, cached(B))).toBeUndefined();
		expect(actions.isBusy(B)).toBe(false);
	});

	it('チェックを外すのに失敗しても、採点は成功として扱う', async () => {
		settings.clearChecksOnGrade = true;
		vault.add(A, enrolled(), '## 思い出せるか\n- [x] 思い出せた\n');
		const stale = cached(A);
		vault.failProcess = true;
		const result = await actions.grade(A, 'good');
		expect(result?.stage).toBe(1);
		expect(result?.bodyError?.message).toBe('書き込めません');
		expect(vault.fm(A)['study-history']).toEqual(['2026-09-28 ok']);
		expect(noticeLog).toEqual([
			'A：次回 10/1(木)',
			'A：復習は記録しましたが、チェックを外せませんでした：書き込めません',
		]);
		// frontmatter は書き込み済みなので、インデックスは書き込んだ状態を使う（押し直しで二重に記録しない）
		expect(actions.stateFor(A, stale)?.stage).toBe(1);
		expect(actions.isBusy(A)).toBe(true);
	});

	it('チェックを外せたら bodyError はない。外すのは指定の見出しの下だけ', async () => {
		settings.clearChecksOnGrade = true;
		vault.add(A, enrolled(), '- [x] タスク\n## 思い出せるか\n- [x] 思い出せた\n');
		const result = await actions.grade(A, 'good');
		expect(result?.bodyError).toBeUndefined();
		expect(vault.notes.get(A)!.body).toBe('- [x] タスク\n## 思い出せるか\n- [ ] 思い出せた\n');
		expect(vault.bodyWrites).toBe(1);
	});

	it('既定（OFF）では本文を書き換えない', async () => {
		vault.add(A, enrolled(), '## 思い出せるか\n- [x] 思い出せた\n');
		await actions.grade(A, 'good');
		expect(vault.notes.get(A)!.body).toBe('## 思い出せるか\n- [x] 思い出せた\n');
		expect(vault.bodyWrites).toBe(0);
	});

	it('見出しの文字列が空（空白のみ）なら、ON でも本文を書き換えない', async () => {
		settings.clearChecksOnGrade = true;
		settings.checkSectionHeading = '  ';
		vault.add(A, enrolled(), '## 思い出せるか\n- [x] 思い出せた\n');
		expect((await actions.grade(A, 'good'))?.bodyError).toBeUndefined();
		expect(vault.notes.get(A)!.body).toBe('## 思い出せるか\n- [x] 思い出せた\n');
		expect(vault.bodyWrites).toBe(0);
	});

	it('外すものがなければ本文を書き込まない', async () => {
		settings.clearChecksOnGrade = true;
		vault.add(A, enrolled(), '## 思い出せるか\n- [ ] 未チェック\n## メモ\n- [x] タスク\n');
		await actions.grade(A, 'good');
		expect(vault.bodyWrites).toBe(0);
		expect(vault.writes).toBe(1);
	});

	it('キャッシュが古く、足されたチェックがファイルにだけあっても外す', async () => {
		settings.clearChecksOnGrade = true;
		vault.add(A, enrolled(), '## 思い出せるか\n- [x] 思い出せた\n');
		vault.cachedBody.set(A, '## 思い出せるか\n- [ ] 思い出せた\n');
		await actions.grade(A, 'good');
		expect(vault.notes.get(A)!.body).toBe('## 思い出せるか\n- [ ] 思い出せた\n');
		expect(vault.bodyWrites).toBe(1);
	});

	it('事前の確認のあとに本文が編集されても、その編集を上書きしない', async () => {
		settings.clearChecksOnGrade = true;
		vault.add(A, enrolled(), '## 思い出せるか\n- [x] a\n');
		vault.editBeforeProcess = (body) => `${body}- [x] 追記\n`;
		await actions.grade(A, 'good');
		expect(vault.notes.get(A)!.body).toBe('## 思い出せるか\n- [ ] a\n- [ ] 追記\n');
	});
});

describe('StudyActions.postpone', () => {
	it('採点の処理中は送らない（採点で決めた次回日を上書きしない）', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const grading = actions.grade(A, 'good');
		const postponing = actions.postpone(studyNote(A, '2026-09-28'));
		g.open();
		expect(await postponing).toBeNull();
		await grading;
		expect(vault.writes).toBe(1);
		expect(vault.fm(A)['study-next']).toBe('2026-10-01');
	});

	it('採点のあとは、画面に出ていた古い予定日ではなく、ファイルの予定日を基準に送る', async () => {
		await actions.grade(A, 'good');
		actions.viewsRefreshing();
		// 画面の行はまだ古い予定日（9/28）を持っていても、採点で決めた 10/1 を基準にする
		expect(await actions.postpone(studyNote(A, '2026-09-28'))).toBe('2026-10-02');
		expect(vault.fm(A)['study-next']).toBe('2026-10-02');
	});

	it('処理中でなければ送り、新しい予定日を返して、実際の日付で通知する', async () => {
		const stale = cached(A);
		expect(await actions.postpone(studyNote(A, '2026-09-28'))).toBe('2026-09-29');
		expect(vault.fm(A)['study-next']).toBe('2026-09-29');
		expect(noticeLog).toEqual(['A を 9/29(火) に送りました']);
		expect(actions.isBusy(A)).toBe(true);
		expect(actions.stateFor(A, stale)?.nextDate).toBe('2026-09-29');
	});

	it('遅れているノートは明日に送り、stage と履歴は変えない', async () => {
		vault.add(A, {
			'study-deck': 'D',
			'study-stage': 2,
			'study-next': '2026-09-23',
			'study-history': ['2026-09-16 ok'],
		});
		expect(await actions.postpone(studyNote(A, '2026-09-23'))).toBe('2026-09-29');
		expect(vault.fm(A)).toEqual({
			'study-deck': 'D',
			'study-stage': 2,
			'study-next': '2026-09-29',
			'study-history': ['2026-09-16 ok'],
		});
		expect(noticeLog).toEqual(['A を 9/29(火) に送りました']);
	});

	it('連打しても書き込みは1回だけ', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const first = actions.postpone(studyNote(A, '2026-09-28'));
		const second = actions.postpone(studyNote(A, '2026-09-28'));
		g.open();
		expect(await first).toBe('2026-09-29');
		expect(await second).toBeNull();
		// 描き直しの前に押し直しても送らない（明後日にならない）
		expect(await actions.postpone(studyNote(A, '2026-09-28'))).toBeNull();
		expect(vault.writes).toBe(1);
		expect(vault.fm(A)['study-next']).toBe('2026-09-29');
		// 無視した要求は通知を出さない
		expect(noticeLog).toEqual(['A を 9/29(火) に送りました']);
	});

	/** D は期間外、E は直前総ざらい中（試験日 10/1、今日 9/28） */
	function sprintActions(): StudyActions {
		const plugin = {
			app: vault.app(),
			settings: {
				...settings,
				decks: [
					{ name: 'D', folder: 'deck', examDate: '2026-12-01' },
					{ name: 'E', folder: 'deck', examDate: '2026-10-01' },
				],
				finalSprintDays: 7,
			},
			invalidateIndex,
		};
		return new StudyActions(plugin as unknown as StudyCurvePlugin);
	}

	it('直前総ざらい中のデッキは送らずに通知し、null を返す', async () => {
		// 描画のあとに試験日を設定した場合など、ボタンが出たままのときの防御
		vault.add(A, { ...enrolled(), 'study-deck': 'E', 'study-next': '2026-09-25' });
		const sprint = sprintActions();
		expect(await sprint.postpone({ ...studyNote(A, '2026-09-25'), deck: 'E' })).toBeNull();
		expect(vault.writes).toBe(0);
		expect(vault.fm(A)['study-next']).toBe('2026-09-25');
		expect(noticeLog).toEqual(['E は直前総ざらいの期間中なので、送れません']);
		sprint.viewsRefreshing();
		expect(sprint.isBusy(A)).toBe(false);
		sprint.dispose();
	});

	it('描画のあとに study-deck が直前総ざらい中のデッキに変わっていたら、送らない', async () => {
		// 画面の行は期間外の D のまま、ファイルは直前総ざらい中の E
		vault.add(A, { ...enrolled(), 'study-deck': 'E' });
		const sprint = sprintActions();
		expect(await sprint.postpone(studyNote(A, '2026-09-28'))).toBeNull();
		expect(vault.writes).toBe(0);
		expect(vault.fm(A)['study-next']).toBe('2026-09-28');
		expect(noticeLog).toEqual(['E は直前総ざらいの期間中なので、送れません']);
		sprint.dispose();
	});

	it('描画のあとに study-deck が期間外のデッキに変わっていたら、送る', async () => {
		// 画面の行は直前総ざらい中の E のまま、ファイルは期間外の D
		const sprint = sprintActions();
		expect(await sprint.postpone({ ...studyNote(A, '2026-09-28'), deck: 'E' })).toBe('2026-09-29');
		expect(vault.fm(A)['study-next']).toBe('2026-09-29');
		sprint.dispose();
	});

	it('試験日を過ぎたデッキは送れる', async () => {
		const plugin = {
			app: vault.app(),
			settings: {
				...settings,
				decks: [{ name: 'D', folder: 'deck', examDate: '2026-09-20' }],
				finalSprintDays: 7,
			},
			invalidateIndex,
		};
		const afterExam = new StudyActions(plugin as unknown as StudyCurvePlugin);
		expect(await afterExam.postpone(studyNote(A, '2026-09-28'))).toBe('2026-09-29');
		afterExam.dispose();
	});

	it('study-deck が消えていたら書き込まずに失敗の通知を出す', async () => {
		vault.add(A, { 'study-next': '2026-09-23' });
		expect(await actions.postpone(studyNote(A, '2026-09-23'))).toBeNull();
		expect(vault.writes).toBe(0);
		expect(vault.fm(A)['study-next']).toBe('2026-09-23');
		expect(noticeLog).toEqual(['予定の変更に失敗しました：このノートは復習対象ではありません']);
		actions.viewsRefreshing();
		expect(actions.isBusy(A)).toBe(false);
	});

	it('失敗したら通知を出し、ロックを外す', async () => {
		expect(await actions.postpone(studyNote('deck/none.md', '2026-09-28'))).toBeNull();
		actions.viewsRefreshing();
		expect(actions.isBusy('deck/none.md')).toBe(false);
		expect(noticeLog[0]).toMatch(/^予定の変更に失敗しました：/);
	});
});

describe('StudyActions.unenroll', () => {
	it('採点の処理中は外さない', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const grading = actions.grade(A, 'good');
		const unenrolling = actions.unenroll(A);
		g.open();
		expect(await unenrolling).toBe(false);
		await grading;
		expect(vault.fm(A)['study-deck']).toBe('D');
		// 処理中で外さなかったことを知らせる（#24 の #6）
		expect(
			noticeLog.filter((message) => message.startsWith('A は採点などの処理中なので')),
		).toEqual([
			'A は採点などの処理中なので、復習対象から外しませんでした。少し待ってからもう一度実行してください',
		]);
	});

	it('書き込みが例外なら、失敗の通知だけを出す（処理中の通知は出さない。#24 の #7）', async () => {
		vault.failSave = true;
		expect(await actions.unenroll(A)).toBe(false);
		expect(noticeLog).toEqual(['復習対象から外すのに失敗しました：保存できません']);
	});

	it('外したら通知を出し、キャッシュが古いあいだは復習対象でない状態を使う', async () => {
		const stale = cached(A);
		expect(await actions.unenroll(A)).toBe(true);
		expect(vault.fm(A)['study-deck']).toBeUndefined();
		expect(noticeLog).toEqual(['A を復習対象から外しました']);
		expect(actions.stateFor(A, stale)).toBeNull();
		expect(actions.stateFor(A, null)).toBeUndefined();
	});
});

describe('StudyActions.dispose', () => {
	it('書き込んだ状態のタイマーを止め、処理中を解く', async () => {
		await actions.grade(A, 'good');
		actions.dispose();
		expect(actions.isBusy(A)).toBe(false);
		vi.advanceTimersByTime(WRITTEN_STATE_TTL_MS);
		expect(invalidateIndex).toHaveBeenCalledTimes(1);
	});
});

describe('StudyActions.enrollMany', () => {
	const C = 'deck/C.md';
	const E = 'deck/E.md';
	const deck: DeckConfig = { name: 'D', folder: 'deck', examDate: null };

	/** 一覧に並ぶ TFile。実行時は差し替えの TFile なので、型だけ obsidian の TFile として渡す */
	function tfile(path: string): VaultFile {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
		return file as unknown as VaultFile;
	}

	function unenrolledNotes(count: number): VaultFile[] {
		return Array.from({ length: count }, (_, i) => {
			const path = `deck/n${i}.md`;
			vault.add(path, { title: `n${i}` });
			return tfile(path);
		});
	}

	beforeEach(() => {
		vault.add(C, { tags: ['aws'] });
		vault.add(E, {});
		// 失敗の console.error をテストの出力に出さない
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('未登録のノートを登録し、件数を通知する', async () => {
		const result = await actions.enrollMany([tfile(C), tfile(E)], deck);
		expect(result).toEqual({ succeeded: 2, skipped: 0, busy: 0, failed: [] });
		expect(vault.fm(C)).toEqual({
			tags: ['aws'],
			'study-deck': 'D',
			'study-stage': 0,
			'study-next': '2026-09-29',
			'study-history': [],
		});
		expect(noticeLog).toEqual(['2 件を「D」に登録しました']);
		expect(actions.isBulkRunning()).toBe(false);
	});

	it('登録済みのノートは、ファイルを書き戻さずに飛ばす', async () => {
		vault.fm(A)['study-stage'] = 3;
		const result = await actions.enrollMany([tfile(A), tfile(C)], deck);
		expect(result).toEqual({ succeeded: 1, skipped: 1, busy: 0, failed: [] });
		expect(vault.writes).toBe(1);
		expect(vault.fm(A)['study-stage']).toBe(3);
		expect(noticeLog).toEqual(['1 件を「D」に登録しました（登録済みだった 1 件はそのまま）']);
	});

	it('キャッシュが古くても、書き込む時点で登録済みなら上書きしない（ステージと履歴を残す）', async () => {
		// 別の端末で登録・採点済み。metadataCache はまだ未登録のまま
		vault.cache.set(C, { tags: ['aws'] });
		vault.add(C, { ...enrolled(), 'study-stage': 2, 'study-history': ['2026-09-27 ok'] });
		const result = await actions.enrollMany([tfile(C)], deck);
		expect(result).toEqual({ succeeded: 0, skipped: 1, busy: 0, failed: [] });
		expect(vault.fm(C)['study-stage']).toBe(2);
		expect(vault.fm(C)['study-history']).toEqual(['2026-09-27 ok']);
		// 値を変えなくても書き戻すと YAML の書式や更新日時が変わるので、書き込まない
		expect(vault.writes).toBe(0);
		// 書き込んでいないので、インデックスはキャッシュの値を使う
		expect(actions.stateFor(C, null)).toBeUndefined();
	});

	it('登録したノートは、キャッシュが古いあいだも登録済みとしてインデックスに使う', async () => {
		await actions.enrollMany([tfile(C)], deck);
		// 未登録の一覧に戻らない
		expect(actions.stateFor(C, null)).toMatchObject({ deck: 'D', stage: 0, nextDate: '2026-09-29' });
		// 描き直すまでは処理中（古い行の押し直しで二重に書き込まない）
		expect(actions.isBusy(C)).toBe(true);
		expect(invalidateIndex).toHaveBeenCalled();
		actions.viewsRefreshing();
		expect(actions.isBusy(C)).toBe(false);
		expect(actions.stateFor(C, cached(C))).toBeUndefined();
	});

	it('解除の直後でキャッシュに古い study-deck が残っていても、登録する', async () => {
		vault.add(C, enrolled());
		await actions.unenroll(C);
		// ファイルは未登録、metadataCache はまだ解除前の状態。一覧は書き込んだ状態で未登録に出る
		vault.cache.set(C, enrolled());
		actions.viewsRefreshing();
		expect(actions.stateFor(C, studyNoteFromFrontmatter(C, 'C', enrolled()))).toBeNull();
		const result = await actions.enrollMany([tfile(C)], deck);
		expect(result).toEqual({ succeeded: 1, skipped: 0, busy: 0, failed: [] });
		expect(vault.fm(C)['study-deck']).toBe('D');
		expect(noticeLog.at(-1)).toBe('1 件を「D」に登録しました');
	});

	it('ほかの操作でそのノートを書き換え中なら、上書きせずに飛ばし、登録していないことを通知する', async () => {
		vault.cache.set(C, {});
		const g = gate();
		vault.nextGate = g.wait;
		// C を解除中（キャッシュは未登録に見える）
		const unenrolling = actions.unenroll(C);
		const result = await actions.enrollMany([tfile(C), tfile(E)], deck);
		g.open();
		await unenrolling;
		expect(result).toEqual({ succeeded: 1, skipped: 0, busy: 1, failed: [] });
		// 「登録済みだった」とは言わない
		expect(noticeLog).toContain(
			'1 件を「D」に登録しました\nほかの操作の処理中だった 1 件は登録していません。終わってからもう一度登録してください',
		);
	});

	it('渡した今日を基準に、すべてのノートの初回の復習日を決める', async () => {
		// 確認ダイアログを開いた日（9/28）のあとに日付をまたいでも、表示した日付で登録する
		vi.setSystemTime(new Date(2026, 8, 29, 0, 1));
		await actions.enrollMany([tfile(C), tfile(E)], deck, '2026-09-28');
		expect(vault.fm(C)['study-next']).toBe('2026-09-29');
		expect(vault.fm(E)['study-next']).toBe('2026-09-29');
	});

	it('失敗したノートを数えて残りを続け、失敗を長めに通知する', async () => {
		const missing1 = tfile('deck/gone1.md');
		const missing2 = tfile('deck/gone2.md');
		const result = await actions.enrollMany([missing1, tfile(C), missing2, tfile(E)], deck);
		expect(result?.succeeded).toBe(2);
		expect(result?.skipped).toBe(0);
		expect(result?.busy).toBe(0);
		expect(result?.failed).toEqual([
			{ path: 'deck/gone1.md', error: 'ノートが見つかりません: deck/gone1.md' },
			{ path: 'deck/gone2.md', error: 'ノートが見つかりません: deck/gone2.md' },
		]);
		expect(vault.fm(E)['study-deck']).toBe('D');
		expect(noticeLog).toEqual([
			'2 件を「D」に登録しました\n2 件は登録に失敗しました：deck/gone1.md ほか 1 件',
		]);
		expect(console.error).toHaveBeenCalledTimes(2);
		// 失敗しても処理中は解ける
		expect(actions.isBulkRunning()).toBe(false);
	});

	it('失敗が1件なら「ほか」を付けない', async () => {
		vault.failSave = true;
		const result = await actions.enrollMany([tfile(C)], deck);
		expect(result?.failed).toEqual([{ path: C, error: '保存できません' }]);
		expect(noticeLog).toEqual(['0 件を「D」に登録しました\n1 件は登録に失敗しました：deck/C.md']);
		expect(actions.isBulkRunning()).toBe(false);
	});

	it('処理中は isBulkRunning が true で、ほかの登録は何もせず null を返す', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const first = actions.enrollMany([tfile(C)], deck);
		expect(actions.isBulkRunning()).toBe(true);
		expect(await actions.enrollMany([tfile(E)], deck)).toBeNull();
		expect(noticeLog).toEqual(['ほかのまとめての処理が終わるまでお待ちください']);
		g.open();
		expect(await first).toEqual({ succeeded: 1, skipped: 0, busy: 0, failed: [] });
		expect(actions.isBulkRunning()).toBe(false);
		expect(vault.fm(E)['study-deck']).toBeUndefined();
	});

	it('確定した時点のデッキ名と試験日で最後まで登録する', async () => {
		// 初回の間隔を3日にし、試験日（9/30）で前倒しされるようにする
		settings.intervalsRaw = '3, 7';
		const target: DeckConfig = { ...deck, examDate: '2026-09-30' };
		const g = gate();
		vault.nextGate = g.wait;
		const running = actions.enrollMany([tfile(C), tfile(E)], target);
		target.name = 'X';
		target.examDate = null;
		g.open();
		await running;
		expect(vault.fm(C)['study-deck']).toBe('D');
		expect(vault.fm(E)['study-deck']).toBe('D');
		expect(vault.fm(E)['study-next']).toBe('2026-09-30');
		expect(noticeLog).toEqual(['2 件を「D」に登録しました']);
	});

	it(`${ENROLL_PROGRESS_THRESHOLD + 1} 件以上なら、消えない通知で1件ごとに進み具合を出し、終わったら閉じる`, async () => {
		const setMessage = vi.spyOn(Notice.prototype, 'setMessage');
		const hide = vi.spyOn(Notice.prototype, 'hide');
		const files = unenrolledNotes(ENROLL_PROGRESS_THRESHOLD + 1);
		const result = await actions.enrollMany(files, deck);
		expect(result?.succeeded).toBe(11);
		expect(noticeLog[0]).toBe('登録中… 0 / 11（D）');
		expect(setMessage).toHaveBeenCalledTimes(11);
		expect(setMessage).toHaveBeenNthCalledWith(1, '登録中… 1 / 11（D）');
		expect(setMessage).toHaveBeenLastCalledWith('登録中… 11 / 11（D）');
		expect(hide).toHaveBeenCalledTimes(1);
		expect(noticeLog.at(-1)).toBe('11 件を「D」に登録しました');
	});

	it(`${ENROLL_PROGRESS_THRESHOLD} 件までは進み具合を出さない`, async () => {
		const setMessage = vi.spyOn(Notice.prototype, 'setMessage');
		await actions.enrollMany(unenrolledNotes(ENROLL_PROGRESS_THRESHOLD), deck);
		expect(setMessage).not.toHaveBeenCalled();
		expect(noticeLog).toEqual(['10 件を「D」に登録しました']);
	});

	it('途中で失敗しても進み具合の通知を閉じる', async () => {
		const hide = vi.spyOn(Notice.prototype, 'hide');
		const files = unenrolledNotes(ENROLL_PROGRESS_THRESHOLD + 1);
		files[3] = tfile('deck/gone.md');
		const result = await actions.enrollMany(files, deck);
		expect(result?.succeeded).toBe(10);
		expect(result?.failed).toHaveLength(1);
		expect(hide).toHaveBeenCalledTimes(1);
	});

	it('対象が0件なら結果の通知だけ出す', async () => {
		expect(await actions.enrollMany([], deck)).toEqual({
			succeeded: 0,
			skipped: 0,
			busy: 0,
			failed: [],
		});
		expect(noticeLog).toEqual(['0 件を「D」に登録しました']);
	});
});

describe('StudyActions.addDecks', () => {
	let deckSettings: { decks: DeckConfig[] };
	let saveSettings: ReturnType<typeof vi.fn>;
	let deckActions: StudyActions;

	beforeEach(() => {
		deckSettings = { decks: [{ name: 'AWS DOP', folder: 'AWS/DOP', examDate: null }] };
		saveSettings = vi.fn(async () => {});
		const plugin = { app: vault.app(), settings: deckSettings, invalidateIndex, saveSettings };
		deckActions = new StudyActions(plugin as unknown as StudyCurvePlugin);
	});

	afterEach(() => {
		deckActions.dispose();
	});

	it('設定にない名前だけを末尾に追加して1回保存し、追加した件数を返す', async () => {
		const ans: DeckConfig = { name: 'AWS ANS', folder: 'AWS/ANS/review', examDate: null };
		const added = await deckActions.addDecks([
			ans,
			{ name: 'AWS DOP', folder: 'other', examDate: '2026-10-25' },
		]);
		expect(added).toBe(1);
		expect(deckSettings.decks.map((deck) => deck.name)).toEqual(['AWS DOP', 'AWS ANS']);
		// 既存のデッキは書き換えない
		expect(deckSettings.decks[0]).toEqual({ name: 'AWS DOP', folder: 'AWS/DOP', examDate: null });
		expect(saveSettings).toHaveBeenCalledTimes(1);
		// 複製して入れる（呼び出し側の値を後から変えても設定は変わらない）
		expect(deckSettings.decks[1]).toEqual(ans);
		expect(deckSettings.decks[1]).not.toBe(ans);
		ans.folder = 'changed';
		expect(deckSettings.decks[1]!.folder).toBe('AWS/ANS/review');
		// 成功の通知は呼び出し側で出す
		expect(noticeLog).toEqual([]);
	});

	it('渡した中で同じ名前が重なっていたら、最初の1つだけ追加する', async () => {
		const added = await deckActions.addDecks([
			{ name: 'A', folder: 'a', examDate: null },
			{ name: 'A', folder: 'b', examDate: null },
		]);
		expect(added).toBe(1);
		expect(deckSettings.decks.filter((deck) => deck.name === 'A')).toEqual([
			{ name: 'A', folder: 'a', examDate: null },
		]);
	});

	it('名前の比較は大文字と小文字を区別する（findDeck と同じ）', async () => {
		expect(await deckActions.addDecks([{ name: 'aws dop', folder: '', examDate: null }])).toBe(1);
	});

	it('追加するものがなければ保存しない', async () => {
		expect(await deckActions.addDecks([{ name: 'AWS DOP', folder: '', examDate: null }])).toBe(0);
		expect(await deckActions.addDecks([])).toBe(0);
		expect(saveSettings).not.toHaveBeenCalled();
	});

	it('続けて呼んでも、同じ名前は1回だけ追加する（連打）', async () => {
		const deck = { name: 'A', folder: 'a', examDate: null };
		const [first, second] = await Promise.all([
			deckActions.addDecks([deck]),
			deckActions.addDecks([deck]),
		]);
		expect([first, second]).toEqual([1, 0]);
		expect(deckSettings.decks.filter((d) => d.name === 'A')).toHaveLength(1);
		expect(saveSettings).toHaveBeenCalledTimes(1);
	});

	it('保存に失敗したら、追加したデッキを外して通知し、null を返す（追加なしの 0 と分ける）', async () => {
		saveSettings.mockRejectedValueOnce(new Error('書き込めません'));
		expect(await deckActions.addDecks([{ name: 'A', folder: 'a', examDate: null }])).toBeNull();
		expect(deckSettings.decks.map((deck) => deck.name)).toEqual(['AWS DOP']);
		expect(noticeLog).toEqual(['デッキの設定の保存に失敗しました：書き込めません']);
	});

	it('保存に失敗したら、外した設定をもう一度保存する（#26 の #30）', async () => {
		const saved: string[][] = [];
		saveSettings.mockImplementation(async () => {
			saved.push(deckSettings.decks.map((deck) => deck.name));
			if (saved.length === 1) throw new Error('書き込めません');
		});
		expect(await deckActions.addDecks([{ name: 'A', folder: 'a', examDate: null }])).toBeNull();
		expect(saved).toEqual([['AWS DOP', 'A'], ['AWS DOP']]);
	});
});

// 設計書 §6.1 の #25〜#29（#26）
describe('StudyActions.updateDeck', () => {
	let plugin: {
		app: ReturnType<FakeVault['app']>;
		settings: { decks: DeckConfig[] };
		invalidateIndex: typeof invalidateIndex;
		saveSettings: ReturnType<typeof vi.fn>;
		isSettingsSaveBlocked: () => boolean;
		getIndex: () => { notes: StudyNote[]; unenrolled: never[] };
	};
	let deckActions: StudyActions;
	let x: DeckConfig;
	let target: DeckConfig;
	const next: DeckConfig = { name: 'AWS SAP', folder: 'AWS/SAP', examDate: '2026-12-01' };
	/** 保存が呼ばれた時点のデッキ名（保存の中身） */
	let saved: string[][];

	beforeEach(() => {
		x = { name: 'X', folder: '', examDate: null };
		target = { name: 'AWS DOP', folder: 'AWS/DOP', examDate: null };
		saved = [];
		plugin = {
			app: vault.app(),
			settings: { decks: [x, target] },
			invalidateIndex,
			saveSettings: vi.fn(async () => {
				saved.push(plugin.settings.decks.map((deck) => deck.name));
			}),
			isSettingsSaveBlocked: () => false,
			// このデッキのノートはない（名前の変更でノートを書き換えるケースは #22 のテストで確かめる）
			getIndex: () => ({ notes: [], unenrolled: [] }),
		};
		deckActions = new StudyActions(plugin as unknown as StudyCurvePlugin);
	});

	afterEach(() => {
		deckActions.dispose();
	});

	it('25. 同じ位置を next の複製に置き換えて保存する', async () => {
		expect(await deckActions.updateDeck(target, next)).toBe('saved');
		expect(plugin.settings.decks[1]).toEqual(next);
		expect(plugin.settings.decks[1]).not.toBe(next);
		expect(plugin.settings.decks[0]).toBe(x);
		expect(saved).toEqual([['X', 'AWS SAP']]);
	});

	it('知らないキーは残す（#27 の読み込みと同じ）', async () => {
		const withExtra = { ...target, color: 'red' } as DeckConfig;
		plugin.settings.decks[1] = withExtra;
		await deckActions.updateDeck(withExtra, next);
		expect(plugin.settings.decks[1]).toEqual({ ...next, color: 'red' });
	});

	it('26. 対象が設定になければ missing で、保存しない', async () => {
		const other = { ...target };
		expect(await deckActions.updateDeck(other, next)).toBe('missing');
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.decks).toEqual([x, target]);
	});

	it('27. 保存が1回目だけ例外なら、target を戻して保存し直し、例外を投げる。押し直せば保存できる', async () => {
		plugin.saveSettings.mockImplementationOnce(async () => {
			saved.push(plugin.settings.decks.map((deck) => deck.name));
			throw new Error('書き込めません');
		});
		await expect(deckActions.updateDeck(target, next)).rejects.toThrow('書き込めません');
		expect(plugin.settings.decks[1]).toBe(target);
		expect(saved).toEqual([['X', 'AWS SAP'], ['X', 'AWS DOP']]);
		// 同じダイアログからの押し直し
		expect(await deckActions.updateDeck(target, next)).toBe('saved');
		expect(plugin.settings.decks[1]).toEqual(next);
	});

	it('28. 保存を待つ間のほかの変更は戻さず、target は複製のあった位置に戻す', async () => {
		const c: DeckConfig = { name: 'C', folder: '', examDate: null };
		const g = gate();
		plugin.saveSettings.mockImplementationOnce(async () => {
			await g.wait;
			throw new Error('書き込めません');
		});
		const updating = deckActions.updateDeck(target, next);
		// 保存を待つ間に、ほかの操作が C を足し、手前の X を消す
		plugin.settings.decks.push(c);
		plugin.settings.decks.splice(0, 1);
		g.open();
		await expect(updating).rejects.toThrow('書き込めません');
		expect(plugin.settings.decks).toEqual([target, c]);
		expect(plugin.settings.decks[0]).toBe(target);
	});

	it('29. 保存を待つ間に設定が読み直されたら、読み直した設定には触らず、保存し直さない', async () => {
		const reloaded = { decks: [{ name: 'AWS DOP', folder: 'AWS/DOP', examDate: null }] };
		const g = gate();
		plugin.saveSettings.mockImplementationOnce(async () => {
			await g.wait;
			throw new Error('書き込めません');
		});
		const updating = deckActions.updateDeck(target, next);
		plugin.settings = reloaded;
		g.open();
		await expect(updating).rejects.toThrow('書き込めません');
		expect(plugin.settings).toBe(reloaded);
		expect(reloaded.decks).toEqual([{ name: 'AWS DOP', folder: 'AWS/DOP', examDate: null }]);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});

// 設計書 §6.1 の #14〜#34（#22 の名前の変更）
describe('StudyActions.updateDeck（名前の変更）', () => {
	const N1 = 'a/1.md';
	const N2 = 'a/2.md';
	let deckA: DeckConfig;
	let renameSettings: {
		intervalsRaw: string;
		decks: DeckConfig[];
		clearChecksOnGrade: boolean;
		checkSectionHeading: string;
	};
	let blocked: boolean;
	let renameActions: StudyActions;
	let saveSettings: ReturnType<typeof vi.fn>;
	/** 設定を保存した時点の、ノートの study-deck */
	let notesAtSave: unknown[][];
	let app: ReturnType<FakeVault['app']>;

	function noteFm(deck: string): Record<string, unknown> {
		return {
			'study-deck': deck,
			'study-stage': 2,
			'study-next': '2026-10-01',
			'study-history': ['2026-09-20 ok'],
			tags: ['x'],
		};
	}

	function tfile(path: string): VaultFile {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
		return file as unknown as VaultFile;
	}

	function rename(target: DeckConfig, name: string) {
		return renameActions.updateDeck(target, { ...target, name });
	}

	/** 待たずに始まったノートの書き換えが終わり、結果の通知が出るまで進める */
	async function settle(): Promise<void> {
		for (let i = 0; i < 10_000 && renameActions.isBulkRunning(); i++) await Promise.resolve();
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(renameActions.isBulkRunning()).toBe(false);
	}

	async function flush(): Promise<void> {
		for (let i = 0; i < 200; i++) await Promise.resolve();
	}

	beforeEach(() => {
		vault.add(N1, noteFm('A'));
		vault.add(N2, noteFm('A'));
		deckA = { name: 'A', folder: 'a', examDate: null };
		renameSettings = {
			intervalsRaw: '1, 3, 7',
			decks: [deckA],
			clearChecksOnGrade: false,
			checkSectionHeading: '思い出せるか',
		};
		blocked = false;
		notesAtSave = [];
		app = vault.app();
		saveSettings = vi.fn(async () => {
			notesAtSave.push([vault.fm(N1)['study-deck'], vault.fm(N2)['study-deck']]);
		});
		const plugin = {
			app,
			settings: renameSettings,
			invalidateIndex,
			saveSettings,
			isSettingsSaveBlocked: () => blocked,
			getIndex: () =>
				buildStudyIndex(app as never, (path, fromCache) => renameActions.stateFor(path, fromCache)),
		};
		renameActions = new StudyActions(plugin as unknown as StudyCurvePlugin);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		renameActions.dispose();
		vi.restoreAllMocks();
	});

	it('14. 設定の名前を変え、古い名前のノートの study-deck だけを書き換えて通知する', async () => {
		expect(await rename(deckA, 'B')).toBe('saved');
		await settle();
		expect(renameSettings.decks.map((deck) => deck.name)).toEqual(['B']);
		expect(vault.fm(N1)).toEqual(noteFm('B'));
		expect(vault.fm(N2)).toEqual(noteFm('B'));
		expect(noticeLog).toEqual(['2 件のノートのデッキを「B」に書き換えました']);
	});

	it('15. 設定を先に保存し、ノートはその後に書き換える', async () => {
		await rename(deckA, 'B');
		await settle();
		expect(notesAtSave).toEqual([['A', 'A']]);
	});

	it('16. 直前の書き換えがキャッシュに反映される前でも、続けて名前を変えられる（キャッシュで飛ばさない）', async () => {
		vault.cache.set(N1, noteFm('A'));
		vault.cache.set(N2, noteFm('A'));
		await rename(deckA, 'B');
		await settle();
		// 描き直し（処理中を解く）
		renameActions.viewsRefreshing();
		expect(await rename(renameSettings.decks[0]!, 'C')).toBe('saved');
		await settle();
		expect(vault.fm(N1)['study-deck']).toBe('C');
		expect(vault.fm(N2)['study-deck']).toBe('C');
	});

	it('17. 書く時点でほかのデッキになっていたノートは上書きせずに飛ばす', async () => {
		vault.add(N2, noteFm('C'));
		vault.cache.set(N2, noteFm('A'));
		await rename(deckA, 'B');
		await settle();
		expect(vault.fm(N1)['study-deck']).toBe('B');
		expect(vault.fm(N2)['study-deck']).toBe('C');
		expect(noticeLog).toEqual([
			'1 件のノートのデッキを「B」に書き換えました（デッキが変わっていた 1 件はそのまま）',
		]);
	});

	it('18. 書き換えたノートは、キャッシュが古いあいだもインデックスで新しい名前', async () => {
		vault.cache.set(N1, noteFm('A'));
		vault.cache.set(N2, noteFm('A'));
		await rename(deckA, 'B');
		await settle();
		const index = buildStudyIndex(app as never, (path, fromCache) =>
			renameActions.stateFor(path, fromCache),
		);
		expect(index.notes.filter((note) => note.filePath.startsWith('a/')).map((n) => n.deck)).toEqual([
			'B',
			'B',
		]);
	});

	it('19. 採点の最中だったノートは、終わってから最後にもう一度試して書き換える', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const grading = renameActions.grade(N1, 'good');
		expect(await rename(deckA, 'B')).toBe('saved');
		await flush();
		expect(vault.fm(N2)['study-deck']).toBe('B');
		g.open();
		await grading;
		// 採点の後の描き直しで、処理中が解ける
		renameActions.viewsRefreshing();
		await vi.advanceTimersByTimeAsync(BULK_RETRY_DELAY_MS);
		await settle();
		expect(vault.fm(N1)['study-deck']).toBe('B');
		expect(noticeLog.at(-1)).toBe('2 件のノートのデッキを「B」に書き換えました');
	});

	it('20. もう一度試しても書き換え中なら、失敗に数えて理由とパスを出す', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		const grading = renameActions.grade(N1, 'good');
		await rename(deckA, 'B');
		await flush();
		await vi.advanceTimersByTimeAsync(BULK_RETRY_DELAY_MS);
		await settle();
		expect(vault.fm(N1)['study-deck']).toBe('A');
		expect(noticeLog.at(-1)).toBe(
			'1 件のノートのデッキを「B」に書き換えました\n1 件は書き換えに失敗しました：a/1.md',
		);
		expect(console.error).toHaveBeenCalledWith(
			'Study Curve: a/1.md のデッキの書き換えに失敗しました：ほかの操作で書き換え中でした',
		);
		g.open();
		await grading;
	});

	it('21. 1件の書き込みが失敗しても残りを続け、失敗を通知する', async () => {
		vault.failSavePaths.add(N1);
		await rename(deckA, 'B');
		await settle();
		expect(vault.fm(N1)['study-deck']).toBe('A');
		expect(vault.fm(N2)['study-deck']).toBe('B');
		expect(noticeLog).toEqual([
			'1 件のノートのデッキを「B」に書き換えました\n1 件は書き換えに失敗しました：a/1.md',
		]);
	});

	it('22. 一括登録の最中は名前を変えず busy（設定も変えない）', async () => {
		vault.add('u/1.md', {});
		const g = gate();
		vault.nextGate = g.wait;
		const enrolling = renameActions.enrollMany([tfile('u/1.md')], deckA);
		expect(await rename(deckA, 'B')).toBe('busy');
		expect(renameSettings.decks[0]).toBe(deckA);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(noticeLog).toEqual(['ほかのまとめての処理が終わるまでお待ちください']);
		g.open();
		await enrolling;
	});

	it('23. 名前の変更の最中は一括登録できない', async () => {
		vault.add('u/1.md', {});
		const g = gate();
		vault.nextGate = g.wait;
		await rename(deckA, 'B');
		expect(renameActions.isBulkRunning()).toBe(true);
		expect(await renameActions.enrollMany([tfile('u/1.md')], deckA)).toBeNull();
		expect(noticeLog).toEqual(['ほかのまとめての処理が終わるまでお待ちください']);
		g.open();
		await settle();
	});

	it('24. 11 件以上なら、消えない通知で進み具合を出し、終わったら閉じる', async () => {
		for (let i = 3; i <= 11; i++) vault.add(`a/${i}.md`, noteFm('A'));
		const setMessage = vi.spyOn(Notice.prototype, 'setMessage');
		const hide = vi.spyOn(Notice.prototype, 'hide');
		await rename(deckA, 'B');
		await settle();
		expect(noticeLog[0]).toBe('書き換え中… 0 / 11（A → B）');
		expect(setMessage).toHaveBeenLastCalledWith('書き換え中… 11 / 11（A → B）');
		expect(hide).toHaveBeenCalledTimes(1);
		expect(noticeLog.at(-1)).toBe('11 件のノートのデッキを「B」に書き換えました');
	});

	it('25. 古い名前のノートが0件なら設定だけを保存し、通知も占有も残さない', async () => {
		const empty: DeckConfig = { name: 'Z', folder: '', examDate: null };
		renameSettings.decks.push(empty);
		const writes = vault.writes;
		expect(await rename(empty, 'Y')).toBe('saved');
		expect(renameSettings.decks[1]?.name).toBe('Y');
		expect(vault.writes).toBe(writes);
		expect(noticeLog).toEqual([]);
		expect(renameActions.isBulkRunning()).toBe(false);
	});

	it('保存を待つ間に古い名前のノートが増えたら、それも書き換える（agy-review の指摘）', async () => {
		const empty: DeckConfig = { name: 'Z', folder: 'z', examDate: null };
		renameSettings.decks.push(empty);
		const g = gate();
		saveSettings.mockImplementationOnce(async () => {
			await g.wait;
		});
		const renaming = rename(empty, 'Y');
		// 保存を待つ間に、同期で Z のノートが届く
		vault.add('z/1.md', noteFm('Z'));
		g.open();
		expect(await renaming).toBe('saved');
		await settle();
		expect(vault.fm('z/1.md')['study-deck']).toBe('Y');
		expect(noticeLog).toEqual(['1 件のノートのデッキを「Y」に書き換えました']);
	});

	it('26. 同じ名前のデッキが設定にもう1つあれば、ノートは書き換えない', async () => {
		renameSettings.decks.push({ name: 'A', folder: 'b', examDate: null });
		expect(await rename(deckA, 'B')).toBe('saved');
		expect(renameSettings.decks.map((deck) => deck.name)).toEqual(['B', 'A']);
		expect(vault.fm(N1)['study-deck']).toBe('A');
		expect(renameActions.isBulkRunning()).toBe(false);
	});

	it('27. 設定を保存できないときは、設定もノートも変えず blocked', async () => {
		blocked = true;
		expect(await rename(deckA, 'B')).toBe('blocked');
		expect(renameSettings.decks[0]).toBe(deckA);
		expect(saveSettings).not.toHaveBeenCalled();
		expect(vault.fm(N1)['study-deck']).toBe('A');
		expect(noticeLog).toEqual([
			'今は設定を保存できないため、デッキを変更しませんでした（プラグインが古いか、設定を読み直しています）。',
		]);
	});

	it('28. 設定の保存が例外なら、占有を外して例外を返し、ノートは書き換えない', async () => {
		saveSettings.mockRejectedValueOnce(new Error('書き込めません'));
		await expect(rename(deckA, 'B')).rejects.toThrow('書き込めません');
		expect(renameActions.isBulkRunning()).toBe(false);
		expect(renameSettings.decks[0]).toBe(deckA);
		expect(vault.fm(N1)['study-deck']).toBe('A');
	});

	it('29. 対象が設定になければ missing', async () => {
		expect(await rename({ ...deckA }, 'B')).toBe('missing');
		expect(renameActions.isBulkRunning()).toBe(false);
	});

	it('31. 設定を保存できないときは、古い名前のノートが0件でも blocked', async () => {
		const empty: DeckConfig = { name: 'Z', folder: '', examDate: null };
		renameSettings.decks.push(empty);
		blocked = true;
		expect(await rename(empty, 'Y')).toBe('blocked');
		expect(renameSettings.decks[1]).toBe(empty);
	});

	it('32. 設定を保存できないときは、名前を変えずにフォルダだけ変えても blocked', async () => {
		blocked = true;
		expect(await renameActions.updateDeck(deckA, { ...deckA, folder: 'other' })).toBe('blocked');
		expect(renameSettings.decks[0]).toBe(deckA);
		expect(deckA.folder).toBe('a');
	});

	it('33. 名前の書き換えの最中に、ノート0件の新しい名前をさらに変えようとしても busy', async () => {
		const g = gate();
		vault.nextGate = g.wait;
		await rename(deckA, 'B');
		const renamed = renameSettings.decks[0]!;
		expect(renamed.name).toBe('B');
		expect(await rename(renamed, 'C')).toBe('busy');
		expect(renameSettings.decks[0]?.name).toBe('B');
		g.open();
		await settle();
	});

	it('34. キャッシュに frontmatter がまだないノートも、インデックスとファイルの値で書き換える', async () => {
		const fresh = 'a/new.md';
		vault.add(fresh, {});
		vault.noCache.add(fresh);
		await renameActions.enrollMany([tfile(fresh)], deckA);
		renameActions.viewsRefreshing();
		noticeLog.length = 0;
		await rename(deckA, 'B');
		await settle();
		expect(vault.fm(fresh)['study-deck']).toBe('B');
		expect(noticeLog).toEqual(['3 件のノートのデッキを「B」に書き換えました']);
	});
});

// 設計書 §6.1 の #13〜#31（#25 のデッキの削除）
describe('StudyActions.removeDeck', () => {
	const N1 = 'a/1.md';
	const N2 = 'a/2.md';
	let deckA: DeckConfig;
	let removeSettings: {
		intervalsRaw: string;
		decks: DeckConfig[];
		clearChecksOnGrade: boolean;
		checkSectionHeading: string;
	};
	let blocked: boolean;
	let removeActions: StudyActions;
	let plugin: {
		app: ReturnType<FakeVault['app']>;
		settings: typeof removeSettings;
		invalidateIndex: typeof invalidateIndex;
		saveSettings: ReturnType<typeof vi.fn>;
		isSettingsSaveBlocked: () => boolean;
		getIndex: () => ReturnType<typeof buildStudyIndex>;
	};
	/** 設定を保存した時点の、デッキ名とノートの study-deck */
	let saved: { decks: string[]; notes: unknown[] }[];

	function noteFm(deck: string): Record<string, unknown> {
		return {
			title: 't',
			'study-deck': deck,
			'study-stage': 2,
			'study-next': '2026-10-01',
			'study-history': ['2026-09-20 ok'],
		};
	}

	function tfile(path: string): VaultFile {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
		return file as unknown as VaultFile;
	}

	/** 待たずに始まったノートの処理が終わり、結果の通知が出るまで進める */
	async function settle(): Promise<void> {
		for (let i = 0; i < 10_000 && removeActions.isBulkRunning(); i++) await Promise.resolve();
		for (let i = 0; i < 20; i++) await Promise.resolve();
		expect(removeActions.isBulkRunning()).toBe(false);
	}

	function snapshot(): { decks: string[]; notes: unknown[] } {
		return {
			decks: plugin.settings.decks.map((deck) => deck.name),
			notes: [vault.fm(N1)['study-deck'], vault.fm(N2)['study-deck']],
		};
	}

	beforeEach(() => {
		vault.add(N1, noteFm('A'));
		vault.add(N2, noteFm('A'));
		deckA = { name: 'A', folder: 'a', examDate: '2026-12-01' };
		removeSettings = {
			intervalsRaw: '1, 3, 7',
			decks: [{ name: 'X', folder: '', examDate: null }, deckA],
			clearChecksOnGrade: false,
			checkSectionHeading: '思い出せるか',
		};
		blocked = false;
		saved = [];
		const app = vault.app();
		plugin = {
			app,
			settings: removeSettings,
			invalidateIndex,
			saveSettings: vi.fn(async () => {
				saved.push(snapshot());
			}),
			isSettingsSaveBlocked: () => blocked,
			getIndex: () =>
				buildStudyIndex(app as never, (path, fromCache) => removeActions.stateFor(path, fromCache)),
		};
		removeActions = new StudyActions(plugin as unknown as StudyCurvePlugin);
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		removeActions.dispose();
		vi.restoreAllMocks();
	});

	it('13. 残して削除：設定から消し、ノートには書かない', async () => {
		const writes = vault.writes;
		expect(await removeActions.removeDeck(deckA, 'keep')).toBe('removed');
		expect(removeSettings.decks.map((deck) => deck.name)).toEqual(['X']);
		expect(vault.writes).toBe(writes);
		expect(vault.fm(N1)).toEqual(noteFm('A'));
		expect(noticeLog).toEqual(['デッキ「A」を設定から削除しました']);
		expect(removeActions.isBulkRunning()).toBe(false);
	});

	it('14. 外して削除：study-* だけを消し、ほかのキーは残す', async () => {
		expect(await removeActions.removeDeck(deckA, 'unenroll')).toBe('removed');
		await settle();
		expect(removeSettings.decks.map((deck) => deck.name)).toEqual(['X']);
		expect(vault.fm(N1)).toEqual({ title: 't' });
		expect(vault.fm(N2)).toEqual({ title: 't' });
		expect(noticeLog).toEqual(['デッキ「A」を設定から削除しました', '2 件を復習対象から外しました']);
	});

	it('15. 設定を先に保存し、ノートはその後に外す', async () => {
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		expect(saved).toEqual([{ decks: ['X'], notes: ['A', 'A'] }]);
	});

	it('16. 名前を変えた直後（キャッシュは古い名前）でも、キャッシュで飛ばさずに外す', async () => {
		vault.add(N1, noteFm('Z'));
		vault.add(N2, noteFm('Z'));
		vault.cache.set(N1, noteFm('Z'));
		vault.cache.set(N2, noteFm('Z'));
		const deckZ: DeckConfig = { name: 'Z', folder: 'a', examDate: null };
		removeSettings.decks = [deckZ];
		await removeActions.updateDeck(deckZ, { ...deckZ, name: 'A' });
		await settle();
		removeActions.viewsRefreshing();
		noticeLog.length = 0;
		expect(await removeActions.removeDeck(removeSettings.decks[0]!, 'unenroll')).toBe('removed');
		await settle();
		expect(vault.fm(N1)).toEqual({ title: 't' });
		expect(noticeLog.at(-1)).toBe('2 件を復習対象から外しました');
	});

	it('17. 書く時点でほかのデッキになっていたノートは外さずに飛ばす', async () => {
		vault.add(N2, noteFm('B'));
		vault.cache.set(N2, noteFm('A'));
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		expect(vault.fm(N1)).toEqual({ title: 't' });
		expect(vault.fm(N2)).toEqual(noteFm('B'));
		expect(noticeLog.at(-1)).toBe('1 件を復習対象から外しました（デッキが変わっていた 1 件はそのまま）');
	});

	it('18. 外したノートは、キャッシュが古いあいだもインデックスで未登録', async () => {
		vault.cache.set(N1, noteFm('A'));
		vault.cache.set(N2, noteFm('A'));
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		const unenrolled = plugin.getIndex().unenrolled.map((file) => file.path);
		expect(unenrolled).toEqual(expect.arrayContaining([N1, N2]));
	});

	it('19. 一括登録の最中は、残して削除も外して削除も busy（設定は変えない）', async () => {
		vault.add('u/1.md', {});
		const g = gate();
		vault.nextGate = g.wait;
		const enrolling = removeActions.enrollMany([tfile('u/1.md')], deckA);
		expect(await removeActions.removeDeck(deckA, 'keep')).toBe('busy');
		expect(await removeActions.removeDeck(deckA, 'unenroll')).toBe('busy');
		expect(removeSettings.decks).toContain(deckA);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		g.open();
		await enrolling;
	});

	it('20. 外している最中は、一括登録も名前の変更もできない', async () => {
		vault.add('u/1.md', {});
		const x = removeSettings.decks[0]!;
		const g = gate();
		vault.nextGate = g.wait;
		await removeActions.removeDeck(deckA, 'unenroll');
		expect(await removeActions.enrollMany([tfile('u/1.md')], x)).toBeNull();
		expect(await removeActions.updateDeck(x, { ...x, name: 'Y' })).toBe('busy');
		g.open();
		await settle();
	});

	it('21. 同じ名前のデッキがもう1つあれば、外して削除でもノートに触れず、デッキは1つだけ消える', async () => {
		const other: DeckConfig = { name: 'A', folder: 'b', examDate: null };
		removeSettings.decks.push(other);
		const writes = vault.writes;
		expect(await removeActions.removeDeck(deckA, 'unenroll')).toBe('removed');
		expect(removeSettings.decks).toEqual([{ name: 'X', folder: '', examDate: null }, other]);
		expect(vault.writes).toBe(writes);
		expect(removeActions.isBulkRunning()).toBe(false);
	});

	it('22. 対象が設定になければ missing で、何も変えない', async () => {
		expect(await removeActions.removeDeck({ ...deckA }, 'unenroll')).toBe('missing');
		expect(removeSettings.decks).toContain(deckA);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it('23. 11 件以上なら、消えない通知で進み具合を出し、終わったら閉じる', async () => {
		for (let i = 3; i <= 11; i++) vault.add(`a/${i}.md`, noteFm('A'));
		const setMessage = vi.spyOn(Notice.prototype, 'setMessage');
		const hide = vi.spyOn(Notice.prototype, 'hide');
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		expect(noticeLog[1]).toBe('復習対象から外しています… 0 / 11（A）');
		expect(setMessage).toHaveBeenLastCalledWith('復習対象から外しています… 11 / 11（A）');
		expect(hide).toHaveBeenCalledTimes(1);
		expect(noticeLog.at(-1)).toBe('11 件を復習対象から外しました');
	});

	it('24. 1件の書き込みが失敗しても残りを続け、失敗を通知する', async () => {
		vault.failSavePaths.add(N1);
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		expect(vault.fm(N1)).toEqual(noteFm('A'));
		expect(vault.fm(N2)).toEqual({ title: 't' });
		expect(noticeLog.at(-1)).toBe('1 件を復習対象から外しました\n1 件は外せませんでした：a/1.md');
		expect(console.error).toHaveBeenCalledWith(
			'Study Curve: a/1.md を復習対象から外せませんでした：保存できません',
		);
	});

	it('25. 設定の保存が例外なら、消す前の設定に戻し、占有を外して例外を返す。ノートは変えない', async () => {
		plugin.saveSettings.mockRejectedValue(new Error('書き込めません'));
		await expect(removeActions.removeDeck(deckA, 'unenroll')).rejects.toThrow('書き込めません');
		expect(removeActions.isBulkRunning()).toBe(false);
		expect(removeSettings.decks[1]).toBe(deckA);
		expect(vault.fm(N1)).toEqual(noteFm('A'));
		// 確認のダイアログは閉じるだけなので、失敗を通知で知らせる（agy-review の指摘）
		expect(noticeLog).toEqual(['デッキの削除を保存できませんでした：書き込めません']);
	});

	it('26. 保存が1回目だけ例外なら、デッキを戻した設定をもう一度保存する', async () => {
		plugin.saveSettings.mockImplementationOnce(async () => {
			saved.push(snapshot());
			throw new Error('書き込めません');
		});
		await expect(removeActions.removeDeck(deckA, 'keep')).rejects.toThrow('書き込めません');
		expect(saved.map((entry) => entry.decks)).toEqual([['X'], ['X', 'A']]);
	});

	it('27. 保存が2回とも例外なら、1回目の例外を返し、占有を外す', async () => {
		plugin.saveSettings
			.mockRejectedValueOnce(new Error('1回目'))
			.mockRejectedValueOnce(new Error('2回目'));
		await expect(removeActions.removeDeck(deckA, 'keep')).rejects.toThrow('1回目');
		expect(removeActions.isBulkRunning()).toBe(false);
		expect(noticeLog).toEqual(['デッキの削除を保存できませんでした：1回目']);
	});

	it('28. 保存を待つ間に設定が読み直されたら、読み直した設定には触らず、保存し直さない', async () => {
		const reloaded = { ...removeSettings, decks: [{ name: 'A', folder: 'a', examDate: null }] };
		const g = gate();
		plugin.saveSettings.mockImplementationOnce(async () => {
			await g.wait;
			throw new Error('書き込めません');
		});
		const removing = removeActions.removeDeck(deckA, 'keep');
		plugin.settings = reloaded;
		g.open();
		await expect(removing).rejects.toThrow('書き込めません');
		expect(reloaded.decks).toEqual([{ name: 'A', folder: 'a', examDate: null }]);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it('29. 設定を保存できないときは、残して削除も外して削除も blocked（占有も取らない）', async () => {
		blocked = true;
		expect(await removeActions.removeDeck(deckA, 'keep')).toBe('blocked');
		expect(await removeActions.removeDeck(deckA, 'unenroll')).toBe('blocked');
		expect(removeSettings.decks).toContain(deckA);
		expect(vault.fm(N1)).toEqual(noteFm('A'));
		expect(removeActions.isBulkRunning()).toBe(false);
		expect(noticeLog).toEqual([
			'今は設定を保存できないため、デッキを削除しませんでした（プラグインが古いか、設定を読み直しています）。',
			'今は設定を保存できないため、デッキを削除しませんでした（プラグインが古いか、設定を読み直しています）。',
		]);
	});

	it('30. キャッシュに frontmatter がまだないノートも、インデックスとファイルの値で外す', async () => {
		const fresh = 'a/new.md';
		vault.add(fresh, {});
		vault.noCache.add(fresh);
		await removeActions.enrollMany([tfile(fresh)], deckA);
		removeActions.viewsRefreshing();
		noticeLog.length = 0;
		await removeActions.removeDeck(deckA, 'unenroll');
		await settle();
		expect(vault.fm(fresh)).toEqual({});
		expect(noticeLog.at(-1)).toBe('3 件を復習対象から外しました');
	});

	it('31. 保存を待つ間にほかの操作が足したデッキは残し、消したデッキだけを戻す', async () => {
		const c: DeckConfig = { name: 'C', folder: '', examDate: null };
		const g = gate();
		plugin.saveSettings.mockImplementationOnce(async () => {
			await g.wait;
			throw new Error('書き込めません');
		});
		const removing = removeActions.removeDeck(deckA, 'keep');
		removeSettings.decks.push(c);
		g.open();
		await expect(removing).rejects.toThrow('書き込めません');
		expect(removeSettings.decks.map((deck) => deck.name)).toEqual(['X', 'A', 'C']);
		expect(removeSettings.decks[1]).toBe(deckA);
	});
});
