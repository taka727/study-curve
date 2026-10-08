import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
		'versions.json',
		'main.js',
		// 確認用の Vault（npm run qa:vault が作る。#16）。中にビルドの main.js のコピーがある
		'test-vault',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tests',
		'vitest.config.ts',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// manifest.json も審査と同じルールで検査する。
		// 推奨設定は validate-manifest を *.ts / *.js にしか適用しないため、
		// ここで TypeScript のパーサーを割り当てて明示的に有効にする。
		files: ['manifest.json'],
		extends: [tseslint.configs.disableTypeChecked],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { projectService: false, extraFileExtensions: ['.json'] },
		},
		rules: { 'obsidianmd/validate-manifest': 'error' },
	},
);
