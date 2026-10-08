import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';

// scripts/lib/ から2つ上がリポジトリ直下。npm を別の場所から実行しても同じファイルを指すようにする。
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * リポジトリ直下の .env.local を読み、まだ設定されていない変数だけを process.env に入れる。
 * ファイルがなければ何もしない。シェルで設定済みの値が優先される。
 * @param {string} [path] 既定はリポジトリ直下の .env.local
 * @returns {string[]} 読み込んだ変数名
 */
export function loadLocalEnv(path = fileURLToPath(new URL('../../.env.local', import.meta.url))) {
	if (!existsSync(path)) return [];
	// util.parseEnv は Node 20.12 / 21.7 以降。名前付きの import にすると古い Node では
	// 読み込みの時点で落ちて理由が分かりにくいので、使う時点で確かめる
	if (typeof util.parseEnv !== 'function') {
		throw new Error(`.env.local の読み込みには Node 20.12 以降が必要です（現在：${process.version}）`);
	}
	const parsed = util.parseEnv(readFileSync(path, 'utf8'));
	const loaded = [];
	for (const [key, value] of Object.entries(parsed)) {
		if (process.env[key] !== undefined) continue;
		process.env[key] = value;
		loaded.push(key);
	}
	return loaded;
}
