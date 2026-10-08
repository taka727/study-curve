import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type StudyCurvePlugin from '../src/main';
import { StudyActions, findNoteTemplate } from '../src/studyCurve/actions';
import { DEFAULT_NOTE_TEMPLATE } from '../src/studyCurve/noteFile';
import type { DeckConfig } from '../src/studyCurve/types';
import { TFile, TFolder, noticeLog } from './obsidian-stub';

// StudyActions.createReviewNote（#10）を、フォルダと frontmatter を扱える Vault の偽物で確かめる。

interface FakeNote {
	fm: Record<string, unknown>;
	body: string;
}

/** テンプレートの frontmatter を読むための最小限の読み取り（key: value、key: [a, b]、true/false） */
function parseContent(content: string): FakeNote {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
	if (!match) return { fm: {}, body: content };
	const fm: Record<string, unknown> = {};
	for (const line of match[1]!.split('\n')) {
		const [key, ...rest] = line.split(':');
		const value = rest.join(':').trim();
		if (!key) continue;
		if (value.startsWith('[') && value.endsWith(']')) {
			const inner = value.slice(1, -1).trim();
			fm[key.trim()] = inner === '' ? [] : inner.split(',').map((item) => item.trim());
		} else if (value === 'true' || value === 'false') {
			fm[key.trim()] = value === 'true';
		} else {
			fm[key.trim()] = value;
		}
	}
	return { fm, body: content.slice(match[0].length) };
}

class FakeVault {
	notes = new Map<string, FakeNote>();
	folders = new Set<string>();
	createdFolders: string[] = [];
	/** getNewFileParent が返すフォルダ（Obsidian の「新規ノートの作成場所」） */
	newFileParent = '';
	failEnroll = false;

	addFile(path: string, content = ''): void {
		this.notes.set(path, parseContent(content));
	}

	private file(path: string): TFile {
		const file = new TFile();
		file.path = path;
		file.basename = path.replace(/^.*\//, '').replace(/\.md$/, '');
		return file;
	}

	/** 本物と同じく、children に直下のファイルとフォルダを持つ */
	private folder(path: string): TFolder & { children: { path: string }[] } {
		const folder = Object.assign(new TFolder(), { children: [] as { path: string }[] });
		folder.path = path;
		const parentOf = (child: string) => (child.includes('/') ? child.slice(0, child.lastIndexOf('/')) : '');
		for (const child of [...this.notes.keys(), ...this.folders]) {
			if (parentOf(child) === path) folder.children.push({ path: child });
		}
		return folder;
	}

	app() {
		return {
			vault: {
				getAbstractFileByPath: (path: string) => {
					if (this.notes.has(path)) return this.file(path);
					if (this.folders.has(path)) return this.folder(path);
					return null;
				},
				getFileByPath: (path: string) => (this.notes.has(path) ? this.file(path) : null),
				getRoot: () => this.folder(''),
				getFolderByPath: (path: string) => (this.folders.has(path) ? this.folder(path) : null),
				cachedRead: async (file: TFile) => {
					const note = this.notes.get(file.path)!;
					const fm = Object.entries(note.fm)
						.map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : String(value)}`)
						.join('\n');
					return fm === '' ? note.body : `---\n${fm}\n---\n${note.body}`;
				},
				create: async (path: string, content: string) => {
					if (this.notes.has(path)) throw new Error('File already exists.');
					this.notes.set(path, parseContent(content));
					return this.file(path);
				},
				createFolder: async (path: string) => {
					this.folders.add(path);
					this.createdFolders.push(path);
					return this.folder(path);
				},
			},
			metadataCache: {
				// 作った直後のノートはまだキャッシュに載っていない
				getFileCache: () => null,
			},
			fileManager: {
				processFrontMatter: async (file: TFile, fn: (fm: Record<string, unknown>) => void) => {
					if (this.failEnroll) throw new Error('保存できません');
					const note = this.notes.get(file.path)!;
					const copy = structuredClone(note.fm);
					fn(copy);
					note.fm = copy;
				},
				getNewFileParent: () => this.folder(this.newFileParent),
			},
			workspace: {
				getActiveFile: () => null,
			},
		};
	}
}

const DECK: DeckConfig = { name: 'AWS DOP', folder: 'AWS/DOP', examDate: null };

let vault: FakeVault;
let settings: { intervalsRaw: string; decks: DeckConfig[]; noteTemplatePath: string };
let actions: StudyActions;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 8, 28, 9, 0, 0));
	vi.stubGlobal('window', globalThis);
	noticeLog.length = 0;
	vault = new FakeVault();
	vault.folders.add('AWS');
	vault.folders.add('AWS/DOP');
	settings = { intervalsRaw: '1, 3, 7', decks: [DECK], noteTemplatePath: '' };
	const plugin = { app: vault.app(), settings, invalidateIndex: vi.fn() };
	actions = new StudyActions(plugin as unknown as StudyCurvePlugin);
});

afterEach(() => {
	actions.dispose();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('StudyActions.createReviewNote', () => {
	it('内蔵の型でデッキのフォルダに作り、登録して通知する', async () => {
		const file = await actions.createReviewNote(DECK, 'IAM のポリシー評価');
		expect(file.path).toBe('AWS/DOP/IAM のポリシー評価.md');
		const note = vault.notes.get(file.path)!;
		expect(note.body).toContain('# IAM のポリシー評価');
		expect(note.body).toContain('思い出せるか');
		expect(note.fm).toEqual({
			'study-deck': 'AWS DOP',
			'study-stage': 0,
			'study-next': '2026-09-29',
			'study-history': [],
		});
		expect(noticeLog).toEqual(['「IAM のポリシー評価」を作成しました（AWS DOP・初回 9/29(火)）']);
	});

	it('見出しは入力どおり、ファイル名は使えない文字を空白にする', async () => {
		const file = await actions.createReviewNote(DECK, 'A/B: 比較?');
		expect(file.path).toBe('AWS/DOP/A B 比較.md');
		expect(vault.notes.get(file.path)!.body).toContain('# A/B: 比較?');
	});

	it('大文字と小文字だけ違う同名のファイルがあれば番号を付ける', async () => {
		vault.addFile('AWS/DOP/iam.md');
		const file = await actions.createReviewNote(DECK, 'IAM');
		expect(file.path).toBe('AWS/DOP/IAM 1.md');
	});

	it('デッキのフォルダがなければ1段ずつ作る', async () => {
		const deck = { ...DECK, folder: '新規/資格/テスト' };
		const file = await actions.createReviewNote(deck, 'x');
		expect(vault.createdFolders).toEqual(['新規', '新規/資格', '新規/資格/テスト']);
		expect(file.path).toBe('新規/資格/テスト/x.md');
	});

	it('フォルダの途中に同じ名前のファイルがあれば、何も作らずに例外', async () => {
		vault.addFile('新規');
		const deck = { ...DECK, folder: '新規/資格' };
		await expect(actions.createReviewNote(deck, 'x')).rejects.toThrow('フォルダを作れません');
		expect([...vault.notes.keys()]).toEqual(['新規']);
	});

	it('フォルダに .. があれば、何も作らずに例外', async () => {
		const deck = { ...DECK, folder: 'AWS/../外' };
		await expect(actions.createReviewNote(deck, 'x')).rejects.toThrow('. や .. を使えません');
		expect(vault.notes.size).toBe(0);
		expect(vault.createdFolders).toEqual([]);
	});

	it('デッキにフォルダがなければ、新規ノートの作成場所に作る（ルートならファイル名だけ）', async () => {
		vault.folders.add('Inbox');
		vault.newFileParent = 'Inbox';
		const deck = { ...DECK, folder: '' };
		expect((await actions.createReviewNote(deck, 'x')).path).toBe('Inbox/x.md');
		vault.newFileParent = '';
		expect((await actions.createReviewNote(deck, 'y')).path).toBe('y.md');
	});

	it('テンプレートの frontmatter は残し、履歴は空、休止は外す。.md を省いたパスでも見つける', async () => {
		vault.addFile(
			'Templates/復習.md',
			'---\ntags: [review]\nstudy-history: [2026-01-01 ok]\nstudy-suspended: true\n---\n# {{title}} {{deck}} {{date}}\n',
		);
		settings.noteTemplatePath = ' Templates/復習 ';
		const file = await actions.createReviewNote(DECK, 'T');
		const note = vault.notes.get(file.path)!;
		expect(note.body).toBe('# T AWS DOP 2026-09-28\n');
		expect(note.fm).toEqual({
			tags: ['review'],
			'study-history': [],
			'study-deck': 'AWS DOP',
			'study-stage': 0,
			'study-next': '2026-09-29',
		});
	});

	it('テンプレートの study-deck・study-stage・study-next は、選んだデッキとステージ0で上書きする', async () => {
		vault.addFile(
			'Templates/コピー.md',
			'---\nstudy-deck: 古いデッキ\nstudy-stage: 5\nstudy-next: 2027-01-01\n---\n# {{title}}\n',
		);
		settings.noteTemplatePath = 'Templates/コピー.md';
		const file = await actions.createReviewNote(DECK, 'T');
		expect(vault.notes.get(file.path)!.fm).toEqual({
			'study-deck': 'AWS DOP',
			'study-stage': 0,
			'study-next': '2026-09-29',
			'study-history': [],
		});
	});

	it('空のテンプレートなら、本文は空で frontmatter だけのノートにする', async () => {
		vault.addFile('Templates/空.md', '');
		settings.noteTemplatePath = 'Templates/空.md';
		const file = await actions.createReviewNote(DECK, 'T');
		const note = vault.notes.get(file.path)!;
		expect(note.body).toBe('');
		expect(note.fm['study-deck']).toBe('AWS DOP');
		expect(noticeLog).toEqual(['「T」を作成しました（AWS DOP・初回 9/29(火)）']);
	});

	it('試験日を過ぎたデッキでも、初回日は前倒しせず通常どおり', async () => {
		const deck = { ...DECK, examDate: '2026-09-01' };
		const file = await actions.createReviewNote(deck, 'T');
		expect(vault.notes.get(file.path)!.fm['study-next']).toBe('2026-09-29');
	});

	it('テンプレートが見つからなければ内蔵の型で作り、そのことを通知する', async () => {
		settings.noteTemplatePath = 'なし.md';
		const file = await actions.createReviewNote(DECK, 'x');
		expect(vault.notes.get(file.path)!.body).toBe(DEFAULT_NOTE_TEMPLATE.replace('{{title}}', 'x'));
		expect(noticeLog).toContain('テンプレート「なし.md」が見つからないため、内蔵の型で作成しました');
	});

	it('登録に失敗しても、作ったファイルを返して通知する', async () => {
		vault.failEnroll = true;
		const file = await actions.createReviewNote(DECK, 'x');
		expect(vault.notes.has(file.path)).toBe(true);
		expect(noticeLog).toEqual([
			'ノートは作成しましたが、復習対象への登録に失敗しました：保存できません',
		]);
	});

	it('同じパスが前の処理の描き直し待ちなら登録せず、登録の失敗としてコマンドを案内する', async () => {
		const first = await actions.createReviewNote(DECK, 'x');
		// 描き直しの前に消して、同じ名前で作り直す（前の登録のパスがまだ処理中）
		vault.notes.delete(first.path);
		noticeLog.length = 0;
		const file = await actions.createReviewNote(DECK, 'x');
		expect(file.path).toBe(first.path);
		expect(vault.notes.get(file.path)!.fm).toEqual({});
		expect(noticeLog).toEqual([
			'ノートは作成しましたが、復習対象への登録に失敗しました：ほかの操作で処理中でした。作成したノートで、コマンド「このノートを復習対象に登録」から登録し直してください',
		]);
	});
});

describe('findNoteTemplate', () => {
	let app: Parameters<typeof findNoteTemplate>[0];

	beforeEach(() => {
		vault.addFile('Templates/復習.md');
		app = vault.app() as unknown as typeof app;
	});

	it('パスのとおりに見つける', () => {
		expect(findNoteTemplate(app, 'Templates/復習.md')?.path).toBe('Templates/復習.md');
	});

	it('.md を省いても、前後に空白があっても見つける', () => {
		expect(findNoteTemplate(app, ' Templates/復習 ')?.path).toBe('Templates/復習.md');
	});

	it('.md を付けて見つからなければ、.md をもう1つ足して探さない', () => {
		vault.addFile('Templates/なし.md.md');
		expect(findNoteTemplate(app, 'Templates/なし.md')).toBeNull();
	});

	it('空白だけ、または見つからなければ null', () => {
		expect(findNoteTemplate(app, '  ')).toBeNull();
		expect(findNoteTemplate(app, 'Templates/なし')).toBeNull();
	});
});
