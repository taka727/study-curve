// 実機の確認（#16）に使う確認用の Vault を作る。作者の実運用の Vault では試さない。
// ノートの日付（遅れ、今日、先）は実行した日を基準に作るので、確認の当日に作り直す。
//
// 使い方：node scripts/make-test-vault.mjs [出力先=test-vault] [--force] [--today=YYYY-MM-DD] [--push]
//   --force  出力先があれば消して作り直す（このスクリプトが作った Vault だけ。_QA.md で見分ける）
//   --today  日付の基準（省略時は実行した日のローカル日付）
//   --push   QA_VAULT_REMOTE（.env.local）へ main・qa-base・端末ごとのブランチを強制 push する
//            （作り直すたびに4端末のブランチを初期状態に戻す）
// 先に npm run build でビルドしておく（Vault の .obsidian/plugins/study-curve/ にコピーし、コミットする。
// モバイルでは npm を実行できないため）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPluginFiles } from './lib/copyPluginFiles.mjs';
import { REPO_ROOT, loadLocalEnv } from './lib/env.mjs';

/** 端末ごとのブランチ。確認の結果は各端末から自分のブランチへ push し、Mac で qa-base との差分を見る */
const DEVICE_BRANCHES = ['qa/mac', 'qa/windows', 'qa/ipad', 'qa/android'];
/** このスクリプトが作った Vault の印。--force はこれがあるフォルダしか消さない */
const MARKER = '_QA.md';
const RECALL_HEADING = '## ✅ 思い出せるか（読む前に）';

function fail(message) {
	console.error(`qa:vault: ${message}`);
	process.exit(1);
}

// ---- 日付 ----

function localToday() {
	const d = new Date();
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
		.map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
		.join('-');
}

/** YYYY-MM-DD に日数を足す（ローカルの日付として計算する。プラグインの dateUtils と同じ考え方） */
export function addDays(dateISO, days) {
	const [y, m, d] = dateISO.split('-').map(Number);
	const date = new Date(y, m - 1, d + days);
	return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
		.map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0'))
		.join('-');
}

// ---- frontmatter（確認用の簡単な YAML） ----

/** YAML の素の文字列として書けない値は JSON の形（二重引用符）で書く。JSON の文字列は YAML としても正しい */
function yamlScalar(value) {
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	const text = String(value);
	const plain =
		text !== '' &&
		!/^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(text) &&
		!/[:#]\s|\s$|:$/.test(text) &&
		!/^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(text);
	return plain ? text : JSON.stringify(text);
}

/**
 * 値はスカラー、スカラーのリスト、1段のオブジェクトだけ。空のリストは `[]` と書く
 * （キーだけを書くと YAML では null になり、プラグインが書く `study-history: []` と形が違ってしまう）
 */
export function frontmatter(fields) {
	const lines = ['---'];
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${key}: []`);
				continue;
			}
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
		} else if (value !== null && typeof value === 'object') {
			const entries = Object.entries(value);
			if (entries.length === 0) {
				lines.push(`${key}: {}`);
				continue;
			}
			lines.push(`${key}:`);
			for (const [sub, subValue] of entries) {
				lines.push(`  ${sub}: ${yamlScalar(subValue)}`);
			}
		} else {
			lines.push(`${key}: ${yamlScalar(value)}`);
		}
	}
	lines.push('---', '');
	return lines.join('\n');
}

function enrolled(deck, { next, stage = 1, history = [], suspended = false }) {
	const fields = { 'study-deck': deck, 'study-stage': stage };
	if (next !== undefined) fields['study-next'] = next;
	fields['study-history'] = history;
	if (suspended) fields['study-suspended'] = true;
	return fields;
}

// ---- 作るもの ----

/** チェックボックスの消去（#20）の確認用。対象の見出しの下と外、コードブロック、frontmatter の値を含む */
function recallNote(title) {
	return [
		frontmatter({ memo: '- [x] これは frontmatter の値（変わらない）' }),
		`# ${title}`,
		'',
		RECALL_HEADING,
		'',
		'- [x] 例1（外れる）',
		'* [X] 例2（外れる）',
		'+ [x] 例3（外れる）',
		'1. [x] 例4（外れる）',
		'- [-] 取り消し（変わらない）',
		'- [>] 先送り（変わらない）',
		'',
		'### 下位の見出し',
		'',
		'- [x] 下位の見出しの中（外れる）',
		'',
		'```',
		'- [x] バッククォートのコードブロックの中（変わらない）',
		'```',
		'',
		'~~~',
		'- [x] チルダのコードブロックの中（変わらない）',
		'~~~',
		'',
		'## 🎯 答え合わせ — これを覚えていればOK',
		'',
		'- [x] 同じレベルの次の見出しの下（変わらない）',
		'',
	].join('\n');
}

/** 確認用の Vault のファイル。改行は \n で書き、CRLF のノートだけ eol を指定する */
export function buildFixtures(today) {
	const day = (offset) => addDays(today, offset);
	const fixtures = [];
	const add = (path, content, eol) => fixtures.push({ path, content, eol });

	// 共通
	add('.obsidian/community-plugins.json', `${JSON.stringify(['study-curve'], null, 2)}\n`);
	add('.gitattributes', '* -text\n');
	add('.gitignore', '.obsidian/workspace*.json\n.DS_Store\n');

	// #20 タスク管理のノート（見出しに「思い出せるか」がない。消去の対象外）
	add(
		'Tasks/project-a.md',
		[
			'# プロジェクト A',
			'',
			'## タスク',
			'',
			'- [x] 完了したタスク',
			'* [X] 星の箇条書きの完了',
			'+ [x] プラスの箇条書きの完了',
			'1. [x] 番号付きの完了',
			'- [-] 取り消したタスク',
			'- [>] 先送りしたタスク',
			'- [ ] 親のタスク',
			'\t- [x] 入れ子の完了',
			'',
		].join('\n'),
	);
	add('Tasks/weekly.md', '# 今週\n\n## 今週やること\n\n- [x] 月曜\n- [ ] 火曜\n- [x] 水曜\n');
	add('Tasks/shopping.md', '# 買い物\n\n- [x] 牛乳\n- [ ] パン\n');

	// #20 消去の範囲と CRLF
	add('Recall/recall-note.md', recallNote('チェックの消去の確認'));
	add('Recall/crlf-note.md', recallNote('CRLF のノート'), '\r\n');

	// #21 未登録のノート 150 本と、登録済みのノート
	for (let chapter = 1; chapter <= 10; chapter++) {
		const ch = String(chapter).padStart(2, '0');
		for (let n = 1; n <= 15; n++) {
			const no = String(n).padStart(2, '0');
			add(`Bulk/ch${ch}/note-${no}.md`, `# 第${chapter}章 その${n}\n\n本文。\n`);
		}
	}
	add(
		'Bulk/already-enrolled.md',
		`${frontmatter(
			enrolled('Bulk', {
				next: day(10),
				stage: 3,
				history: [`${day(-20)} ok`, `${day(-13)} ok`, `${day(-6)} ok`],
			}),
		)}# 登録済み（一括登録で上書きされない）\n`,
	);

	// 深いフォルダ、いろいろなファイル名（Android の共有ストレージと Windows で使える文字だけ）
	add('Deep/a/b/c/d/e/f/deep-note.md', '# 深いフォルダのノート\n');
	add('Names/日本語のノート.md', '# 日本語のノート\n');
	add('Names/révision française.md', '# Révision française\n');
	add('Names/📚 emoji.md', '# 📚 emoji\n');
	add("Names/spaces and (parens) & amp's.md", '# spaces and (parens)\n');

	// 既存の frontmatter を持つノート（登録・採点で消えないか）
	add(
		'Existing/existing-note.md',
		`${frontmatter({
			tags: ['study', 'qa'],
			aliases: ['既存のノート'],
			custom: 'keep me',
			nested: { level: 2, label: 'inner' },
			list: [1, 2, 3],
		})}# 既存の frontmatter を持つノート\n`,
	);
	add(
		'Existing/existing-note-2.md',
		`${frontmatter({ tags: ['qa'], source: 'https://example.com/page' })}# もう1本の既存のノート\n`,
	);

	// #18・#19 採点と明日に送る（デッキ Queue。試験日なし）
	const queue = [
		['overdue-5', { next: day(-5), stage: 2, history: [`${day(-12)} ok`] }],
		['overdue-1', { next: day(-1), stage: 1, history: [`${day(-4)} ok`] }],
		['today', { next: today, stage: 1, history: [`${day(-3)} hard`] }],
		['future-3', { next: day(3), stage: 2, history: [`${day(-4)} ok`] }],
		['no-next', { stage: 0 }],
		['suspended', { next: today, stage: 1, suspended: true }],
	];
	for (const [name, state] of queue) {
		add(`Queue/${name}.md`, `${frontmatter(enrolled('Queue', state))}# Queue ${name}\n`);
	}

	// #18 直前の総ざらい（試験日は確認の手順 C3 で設定画面から入れる）
	for (const [name, next] of [
		['overdue', day(-2)],
		['today', today],
		['future', day(5)],
	]) {
		add(`Sprint/${name}.md`, `${frontmatter(enrolled('Sprint', { next }))}# Sprint ${name}\n`);
	}

	// #9 設定にないデッキ名のノート
	add('Legacy/legacy-1.md', `${frontmatter(enrolled('Legacy Deck', { next: day(1) }))}# Legacy 1\n`);
	add('Legacy/sub/legacy-2.md', `${frontmatter(enrolled('Legacy Deck', { next: day(2) }))}# Legacy 2\n`);
	add(
		'Colon/colon-note.md',
		`${frontmatter(enrolled('Deck: with colon', { next: day(1) }))}# コロンを含むデッキ名\n`,
	);

	// #10 同じ名前の回避と、テンプレート
	add('Decks/Chemistry/Acids.md', '# Acids\n');
	add(
		'Templates/review-template.md',
		`${frontmatter({ tags: ['review'] })}# {{title}}\n\n- デッキ：{{deck}}\n- 作った日：{{date}}\n\n${RECALL_HEADING}\n\n**例1**\n\n## 🎯 答え合わせ — これを覚えていればOK\n\n- **OK**：\n- **なぜ**：\n`,
	);

	// #18・#19 ブロック
	add(
		'Daily/today.md',
		[
			`# ${today}`,
			'',
			'```study-today',
			'```',
			'',
			'```study-forecast',
			'days: 30',
			'```',
			'',
			'```study-progress',
			'```',
			'',
		].join('\n'),
	);

	// #13 書き方ガイドのサンプル（日本語）。デッキのフォルダに写して登録を確かめる
	const examplesDir = join(REPO_ROOT, 'docs/examples/ja');
	if (existsSync(examplesDir)) {
		for (const name of readdirSync(examplesDir).filter((f) => f.endsWith('.md')).sort()) {
			add(`Examples/${name}`, readFileSync(join(examplesDir, name), 'utf8'));
		}
	}

	// #27 設定の版と読み込みの確認用の data.json の見本（.obsidian/plugins/study-curve/data.json に写して使う）
	const p1Settings = {
		decks: [{ name: 'Queue', folder: 'Queue', examDate: null }],
		intervalsRaw: '1, 3, 7, 14, 30, 60, 90',
		finalSprintDays: 7,
		dailyLimit: 20,
		forecastDays: 14,
		autoAdvance: true,
		clearChecksOnGrade: false,
		checkSectionHeading: '思い出せるか',
		noteTemplatePath: '',
	};
	const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
	add('_qa-data/settings-p1-no-version.json', json(p1Settings));
	add('_qa-data/settings-invalid-values.json', json({ ...p1Settings, dailyLimit: 'abc', forecastDays: 0 }));
	add('_qa-data/settings-newer-version.json', json({ ...p1Settings, version: 99 }));
	add('_qa-data/settings-broken.json', '{\n');

	add(
		MARKER,
		[
			'# Study Curve 確認用の Vault',
			'',
			`- 作った日：${today}（ノートの日付はこの日が基準。確認の当日に作り直す）`,
			'- 確認の手順：[確認項目（docs/design/p1/16-qa.md の §4.3）](https://github.com/taka727/study-curve-dev/blob/main/docs/design/p1/16-qa.md#43-処理の流れ)',
			'- 結果の記録：[Issue #16](https://github.com/taka727/study-curve-dev/issues/16)',
			'- ブランチ：qa-base（初期状態のタグ）から、端末ごとに qa/mac・qa/windows・qa/ipad・qa/android',
			'- `.obsidian/plugins/study-curve/data.json` は作っていない（新しく入れた人と同じ状態）',
			'- `_qa-data/` の JSON は、設定の版と読み込み（#27）の確認で data.json に写して使う',
			'',
		].join('\n'),
	);
	return fixtures;
}

function writeFixture(root, fixture) {
	const path = join(root, fixture.path);
	mkdirSync(dirname(path), { recursive: true });
	const content = fixture.eol === '\r\n' ? fixture.content.replace(/\n/g, '\r\n') : fixture.content;
	writeFileSync(path, content);
}

/** リポジトリ直下のビルド成果物を Vault のプラグインのフォルダへコピーする（先に npm run build） */
function copyBuild(root) {
	mkdirSync(join(root, '.obsidian/plugins'), { recursive: true });
	try {
		copyPluginFiles(join(root, '.obsidian/plugins/study-curve'));
	} catch (error) {
		fail(`${error.message}（先に npm run build を実行してください）`);
	}
}

function git(root, ...args) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

/**
 * git init と最初のコミット、タグ qa-base、端末ごとのブランチ。コミットの作者は、このリポジトリの設定
 * （GitHub の noreply のアドレス）を使う（個人のメールアドレスを非公開のリポジトリにも残さない）
 */
function initGit(root, today, { name, email }) {
	git(root, 'init', '-q', '-b', 'main');
	git(root, 'config', 'user.name', name);
	git(root, 'config', 'user.email', email);
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', `QA base ${today}`);
	git(root, 'tag', '-f', 'qa-base');
	for (const branch of DEVICE_BRANCHES) git(root, 'branch', '-f', branch);
}

/**
 * コミットの作者（このリポジトリの git の設定）。未設定なら、ファイルを作る前に理由を出して止まる
 * （仮の名前で作ると、どのアドレスでコミットされたか分からなくなるため）
 */
function commitIdentity() {
	const read = (key) => {
		try {
			return git(REPO_ROOT, 'config', key);
		} catch {
			return '';
		}
	};
	const name = read('user.name');
	const email = read('user.email');
	if (name === '' || email === '') {
		fail('git の user.name と user.email が未設定です。このリポジトリで git config user.name・user.email を設定してください');
	}
	return { name, email };
}

/** YYYY-MM-DD の形で、かつ実在する日付か（2026-02-30 は false。プラグインの isCalendarDate と同じ） */
function isCalendarDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	return addDays(value, 0) === value;
}

function pushAll(root, remote) {
	git(root, 'push', '-q', '--force', remote, 'main', ...DEVICE_BRANCHES);
	git(root, 'push', '-q', '--force', remote, 'refs/tags/qa-base');
}

function main(argv) {
	const args = argv.filter((a) => !a.startsWith('--'));
	const force = argv.includes('--force');
	const push = argv.includes('--push');
	const todayArg = argv.find((a) => a.startsWith('--today='))?.slice('--today='.length);
	if (todayArg !== undefined && !isCalendarDate(todayArg)) {
		fail(`--today は実在する日付を YYYY-MM-DD で指定してください（指定：${todayArg}）`);
	}
	const today = todayArg ?? localToday();
	const out = args[0] ?? 'test-vault';
	const root = isAbsolute(out) ? out : resolve(REPO_ROOT, out);
	if (root === resolve(REPO_ROOT)) fail('出力先にリポジトリそのものは指定できません');

	// 確かめられることは、今の Vault を消す前にすべて確かめる（途中で止まって何も残らない、を防ぐ）
	const identity = commitIdentity();
	let remote;
	if (push) {
		loadLocalEnv();
		remote = process.env.QA_VAULT_REMOTE;
		if (!remote) fail('QA_VAULT_REMOTE が未設定です。.env.example を参考に .env.local に書いてください');
	}
	if (existsSync(root)) {
		if (!force) fail(`${root} がすでにあります。作り直すなら --force を付けてください`);
		if (!existsSync(join(root, MARKER))) {
			fail(`${root} はこのスクリプトが作った Vault ではない（${MARKER} がない）ので消しません`);
		}
		rmSync(root, { recursive: true, force: true });
	}

	const fixtures = buildFixtures(today);
	for (const fixture of fixtures) writeFixture(root, fixture);
	copyBuild(root);
	initGit(root, today, identity);
	console.log(`qa:vault: ${root} を作りました（${fixtures.length} ファイル、基準日 ${today}）`);
	if (remote) {
		pushAll(root, remote);
		console.log(`qa:vault: main・qa-base・${DEVICE_BRANCHES.join('・')} を push しました`);
	}
}

// テストから buildFixtures などを読み込むときは実行しない
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
