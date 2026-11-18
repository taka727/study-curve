import { beforeEach, describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { StudyIndexStore } from '../src/studyCurve/studyCache';
import { StudyNote } from '../src/studyCurve/types';

// インデックスを、変わったファイルの分だけ差し替える（#13）

function file(path: string): TFile {
	const created = new TFile();
	created.path = path;
	created.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
	return created;
}

function note(path: string, overrides: Partial<StudyNote> = {}): StudyNote {
	return {
		filePath: path,
		basename: path.replace(/^.*\//, '').replace(/\.md$/, ''),
		deck: 'A',
		stage: 0,
		nextDate: '2026-09-28',
		history: [],
		suspended: false,
		...overrides,
	};
}

/** Vault の中身（ファイルと、登録済みならその状態）を差し替えられる偽物 */
let files: TFile[];
let states: Map<string, StudyNote | null>;
let listCalls: number;
let store: StudyIndexStore;

function put(target: TFile, state: StudyNote | null): void {
	if (!files.includes(target)) files.push(target);
	states.set(target.path, state);
}

const paths = () => ({
	notes: store.get().notes.map((value) => value.filePath),
	unenrolled: store.get().unenrolled.map((value) => value.path),
});

beforeEach(() => {
	files = [];
	states = new Map();
	listCalls = 0;
	store = new StudyIndexStore(
		() => {
			listCalls++;
			return [...files];
		},
		(target) => states.get(target.path) ?? null,
	);
});

describe('StudyIndexStore', () => {
	it('最初に使うときに全体から作り、パスの順に並べる', () => {
		put(file('b.md'), note('b.md'));
		put(file('memo.md'), null);
		put(file('a.md'), note('a.md'));
		expect(paths()).toEqual({ notes: ['a.md', 'b.md'], unenrolled: ['memo.md'] });
		expect(listCalls).toBe(1);
	});

	it('作る前の変更は true を返すだけで、全体の読み直しはしない', () => {
		const target = file('a.md');
		put(target, note('a.md'));
		expect(store.update(target)).toBe(true);
		expect(store.remove('a.md')).toBe(true);
		expect(listCalls).toBe(0);
	});

	it('登録していないノートの編集では、中身が変わらず false', () => {
		const memo = file('memo.md');
		put(memo, null);
		put(file('a.md'), note('a.md'));
		const before = store.get();
		expect(store.update(memo)).toBe(false);
		expect(store.get()).toBe(before);
		expect(listCalls).toBe(1);
	});

	it('登録済みのノートの本文だけの編集（状態が同じ）では false', () => {
		const target = file('a.md');
		put(target, note('a.md', { stage: 2 }));
		const before = store.get();
		states.set('a.md', note('a.md', { stage: 2 }));
		expect(store.update(target)).toBe(false);
		expect(store.get()).toBe(before);
	});

	it('状態が変わったら差し替えて true。全体は読み直さない', () => {
		const target = file('a.md');
		put(target, note('a.md', { stage: 1 }));
		put(file('b.md'), note('b.md'));
		const before = store.get();
		states.set('a.md', note('a.md', { stage: 2, nextDate: '2026-10-05' }));
		expect(store.update(target)).toBe(true);
		expect(store.get()).not.toBe(before);
		expect(store.get().notes[0]).toMatchObject({ stage: 2, nextDate: '2026-10-05' });
		expect(before.notes[0]).toMatchObject({ stage: 1 });
		expect(listCalls).toBe(1);
	});

	it('休止の切り替えも状態の変化として扱う', () => {
		const target = file('a.md');
		put(target, note('a.md'));
		store.get();
		states.set('a.md', note('a.md', { suspended: true }));
		expect(store.update(target)).toBe(true);
		expect(store.get().notes[0]?.suspended).toBe(true);
	});

	it('登録したら未登録から登録済みへ、順番を保って移す', () => {
		const target = file('b.md');
		put(file('a.md'), note('a.md'));
		put(target, null);
		put(file('c.md'), note('c.md'));
		put(file('d.md'), null);
		store.get();
		states.set('b.md', note('b.md'));
		expect(store.update(target)).toBe(true);
		expect(paths()).toEqual({ notes: ['a.md', 'b.md', 'c.md'], unenrolled: ['d.md'] });
	});

	it('外したら登録済みから未登録へ、順番を保って移す', () => {
		const target = file('b.md');
		put(file('a.md'), null);
		put(target, note('b.md'));
		put(file('c.md'), null);
		store.get();
		states.set('b.md', null);
		expect(store.update(target)).toBe(true);
		expect(paths()).toEqual({ notes: [], unenrolled: ['a.md', 'b.md', 'c.md'] });
	});

	it('新しいファイルは、登録していなければ未登録に入れて true', () => {
		put(file('a.md'), null);
		put(file('c.md'), null);
		store.get();
		const created = file('b.md');
		put(created, null);
		expect(store.update(created)).toBe(true);
		expect(paths().unenrolled).toEqual(['a.md', 'b.md', 'c.md']);
	});

	it('日本語のパスも、全体から作ったときと同じ順に入れる', () => {
		const names = ['フォルダ/う.md', 'フォルダ/あ.md', 'Z.md', 'a.md', 'フォルダ/い.md'];
		for (const name of names) put(file(name), note(name));
		const expected = paths().notes;

		store.invalidate();
		files = [];
		for (const name of names.slice(0, 2)) put(file(name), note(name));
		store.get();
		for (const name of names.slice(2)) {
			const added = file(name);
			put(added, note(name));
			store.update(added);
		}
		expect(paths().notes).toEqual(expected);
	});

	it('消えたファイルを除いて true。インデックスになければ false', () => {
		put(file('a.md'), note('a.md'));
		put(file('memo.md'), null);
		store.get();
		expect(store.remove('a.md')).toBe(true);
		expect(store.remove('memo.md')).toBe(true);
		expect(paths()).toEqual({ notes: [], unenrolled: [] });
		expect(store.remove('a.md')).toBe(false);
	});

	it('名前の変更は、古いパスを消して新しいパスを入れる', () => {
		const target = file('a.md');
		put(target, note('a.md'));
		put(file('m.md'), note('m.md'));
		store.get();
		const oldPath = target.path;
		target.path = 'z.md';
		target.basename = 'z';
		states.delete(oldPath);
		states.set('z.md', note('z.md'));
		expect(store.rename(target, oldPath)).toBe(true);
		expect(paths().notes).toEqual(['m.md', 'z.md']);
		expect(listCalls).toBe(1);
	});

	it('登録していないノートの移動も、元の場所から除いて新しい場所に入れ直す', () => {
		// 未登録の一覧は TFile をそのまま持つので、通知の時点で path はもう新しい値になっている
		const target = file('A/memo.md');
		put(target, null);
		put(file('B/x.md'), null);
		put(file('C/y.md'), null);
		store.get();
		target.path = 'C/z.md';
		target.basename = 'z';
		expect(store.rename(target, 'A/memo.md')).toBe(true);
		expect(paths().unenrolled).toEqual(['B/x.md', 'C/y.md', 'C/z.md']);
		expect(store.get().unenrolled[2]).toBe(target);
		expect(listCalls).toBe(1);
	});

	it('md でない拡張子に変えたら除き、md に戻したら入れる', () => {
		const target = file('memo.md');
		put(target, null);
		put(file('b.md'), note('b.md'));
		store.get();
		target.path = 'memo.txt';
		target.extension = 'txt';
		expect(store.rename(target, 'memo.md')).toBe(true);
		expect(paths()).toEqual({ notes: ['b.md'], unenrolled: [] });

		target.path = 'memo.md';
		target.extension = 'md';
		expect(store.rename(target, 'memo.txt')).toBe(true);
		expect(paths()).toEqual({ notes: ['b.md'], unenrolled: ['memo.md'] });
		expect(listCalls).toBe(1);
	});

	it('インデックスにない md 以外のファイルの名前の変更では false', () => {
		put(file('a.md'), note('a.md'));
		store.get();
		const image = file('img.png');
		image.extension = 'png';
		image.path = 'img2.png';
		expect(store.rename(image, 'img.png')).toBe(false);
	});

	it('登録済みのノートを未登録のノートと同じ場所に重ねても、二重に入らない', () => {
		const target = file('a.md');
		put(target, note('a.md'));
		const stale = file('b.md');
		put(stale, null);
		store.get();
		target.path = 'b.md';
		target.basename = 'b';
		states.set('b.md', note('b.md'));
		expect(store.rename(target, 'a.md')).toBe(true);
		expect(paths()).toEqual({ notes: ['b.md'], unenrolled: [] });
	});

	it('invalidate のあとは、次に使うときに全体から作り直す', () => {
		put(file('a.md'), note('a.md'));
		store.get();
		put(file('b.md'), note('b.md'));
		store.invalidate();
		expect(paths().notes).toEqual(['a.md', 'b.md']);
		expect(listCalls).toBe(2);
	});
});
