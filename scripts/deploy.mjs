// main の本番ビルドを、実運用の Vault（OBSIDIAN_PLUGIN_DIR）へコピーする。
// 作業中のブランチのビルドが実運用の Vault と同期先の端末に届かないよう、
// 「main で、未コミットの変更がなく、origin/main と同じ」ときだけ動く。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyPluginFiles } from './lib/copyPluginFiles.mjs';
import { REPO_ROOT, loadLocalEnv } from './lib/env.mjs';

function fail(message) {
	console.error(`deploy: ${message}`);
	process.exit(1);
}

// シェルを通さない（パスに空白があっても壊れない）
function git(...args) {
	return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

loadLocalEnv();
const dest = process.env.OBSIDIAN_PLUGIN_DIR;
if (!dest) {
	fail('OBSIDIAN_PLUGIN_DIR が未設定です。.env.example を参考に .env.local を作ってください');
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') {
	fail(`deploy は main ブランチからのみ実行できます（現在：${branch}）`);
}
if (git('status', '--porcelain') !== '') {
	fail('未コミットの変更があります。コミットするか退避してから実行してください');
}
// fetch はしない（ネットワークに依存させない）。直前に git pull する運用とする
let upstream;
try {
	upstream = git('rev-parse', 'origin/main');
} catch {
	fail('origin/main が見つかりません');
}
const head = git('rev-parse', 'HEAD');
if (head !== upstream) {
	fail('main が origin/main と一致しません。git pull / git push で揃えてから実行してください');
}

try {
	// Windows の npm は npm.cmd。.cmd は Node の仕様でシェルを通さないと起動できない
	const windows = process.platform === 'win32';
	execFileSync(windows ? 'npm.cmd' : 'npm', ['run', 'build'], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		shell: windows,
	});
} catch {
	fail('ビルドに失敗したので、コピーしていません');
}

let copied;
try {
	copied = copyPluginFiles(dest);
} catch (error) {
	fail(`コピーを中止しました：${error.message}`);
}

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.json'), 'utf8'));
console.log(`deployed ${manifest.id} ${manifest.version} (${head.slice(0, 7)}) → ${dest}`);
for (const { file, bytes } of copied) console.log(`  ${file} ${bytes} bytes`);
console.log('Obsidian で「コミュニティプラグインを再読み込み」するか、アプリを再起動してください');
