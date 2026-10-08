import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { REPO_ROOT } from './env.mjs';

export const PLUGIN_FILES = ['main.js', 'manifest.json', 'styles.css'];

function pluginId() {
	return JSON.parse(readFileSync(join(REPO_ROOT, 'manifest.json'), 'utf8')).id;
}

// existsSync はリンク先を見るので、リンク先が消えたシンボリックリンクも拾えるよう lstat で調べる
function isSymlink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/**
 * ビルド成果物をプラグインのフォルダへコピーする。安全確認に失敗したら例外を投げ、何もコピーしない。
 * @param {string} destDir コピー先（絶対パス。例：<Vault>/.obsidian/plugins/study-curve）
 * @returns {{ file: string, bytes: number }[]}
 * @throws {Error} 絶対パスでない／フォルダ名が manifest の id と違う／親フォルダ（.obsidian/plugins）がない／成果物がない
 */
export function copyPluginFiles(destDir) {
	// 相対パスだと、リポジトリの中に書き込む事故になる
	if (!isAbsolute(destDir)) {
		throw new Error(`コピー先は絶対パスで指定してください（指定：${destDir}）`);
	}
	// ID を変えた前後で、古いフォルダへ入れてしまう事故を防ぐ
	const id = pluginId();
	if (basename(destDir) !== id) {
		throw new Error(
			`コピー先のフォルダ名が manifest.json の id と違います（期待：${id}、指定：${basename(destDir)}）`,
		);
	}
	// Vault の場所を打ち間違えたときに、新しいフォルダ階層を作らない。作るのは最後の1階層だけ
	const parent = dirname(destDir);
	if (!existsSync(parent) || !statSync(parent).isDirectory()) {
		throw new Error(`親フォルダがありません：${parent}（Vault の .obsidian/plugins を指しているか確かめてください）`);
	}
	const missing = PLUGIN_FILES.filter((file) => !existsSync(join(REPO_ROOT, file)));
	if (missing.length > 0) {
		throw new Error(`ビルド成果物がありません：${missing.join(', ')}（先に npm run build を実行してください）`);
	}

	if (!existsSync(destDir)) mkdirSync(destDir);
	return PLUGIN_FILES.map((file) => {
		const dest = join(destDir, file);
		// 旧方式のシンボリックリンクが残っていると、コピーがリンク先（リポジトリの自分自身）への書き込みになる
		if (isSymlink(dest)) rmSync(dest);
		copyFileSync(join(REPO_ROOT, file), dest);
		return { file, bytes: statSync(dest).size };
	});
}
