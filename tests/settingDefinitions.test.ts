import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingDefinitionItem } from 'obsidian';
import type StudyCurvePlugin from '../src/main';
import { DEFAULT_SETTINGS, StudyCurveSettingTab, StudyCurveSettings } from '../src/settings';
import { stubApiVersion } from './obsidian-stub';

// Obsidian 1.13 以上の設定画面と設定の検索に使う定義（#1）

function tabWith(settings: StudyCurveSettings) {
	const getIndex = vi.fn(() => ({ notes: [], unenrolled: [] }));
	const plugin = { settings, getIndex } as unknown as StudyCurvePlugin;
	return { tab: new StudyCurveSettingTab({} as never, plugin), getIndex };
}

interface Group {
	type: string;
	heading?: string;
	items?: { name: string; desc?: unknown }[];
}

function groups(items: SettingDefinitionItem[]): Group[] {
	return items as unknown as Group[];
}

describe('StudyCurveSettingTab.getSettingDefinitions', () => {
	it('見出しごとのグループに、すべての設定の名前と説明を入れる（設定の検索に出る）', () => {
		const { tab } = tabWith({ ...DEFAULT_SETTINGS, decks: [] });
		const result = groups(tab.getSettingDefinitions());
		expect(result.map((group) => [group.type, group.heading])).toEqual([
			['group', '復習間隔'],
			['group', '復習ノート'],
			['group', 'デッキ（資格・科目）'],
		]);
		expect(result.map((group) => group.items?.map((item) => item.name))).toEqual([
			[
				'ステージごとの間隔（日）',
				'1日に出す上限',
				'直前総ざらいの日数',
				'予定グラフの日数',
				'採点したら次のノートを開く',
				'ステータスバーに今日の復習件数を出す',
			],
			['採点したら本文のチェックを外す', 'チェックを外す見出し', '復習ノートのテンプレート'],
			['デッキを追加'],
		]);
		for (const group of result) {
			for (const item of group.items ?? []) expect(typeof item.desc).toBe('string');
		}
	});

	it('デッキがなければ、「デッキを追加」の説明で知らせる', () => {
		const { tab } = tabWith({ ...DEFAULT_SETTINGS, decks: [] });
		const deckGroup = groups(tab.getSettingDefinitions())[2]!;
		expect(deckGroup.items?.[0]?.desc).toContain('まだデッキがありません');
	});

	it('デッキの行は、名前（空なら「（名前なし）」）とフォルダで探せる', () => {
		const { tab } = tabWith({
			...DEFAULT_SETTINGS,
			decks: [
				{ name: 'AWS', folder: 'Study/AWS', examDate: null },
				{ name: ' ', folder: '', examDate: null },
			],
		});
		const deckGroup = groups(tab.getSettingDefinitions())[2]!;
		expect(deckGroup.items?.map((item) => [item.name, item.desc])).toEqual([
			['AWS', 'Study/AWS'],
			['（名前なし）', ''],
			['デッキを追加', expect.not.stringContaining('まだデッキがありません')],
		]);
	});

	it('定義を作るだけでは Vault を読まない（設定画面を作る起動中にも呼ばれるため）', () => {
		const { tab, getIndex } = tabWith({
			...DEFAULT_SETTINGS,
			decks: [{ name: 'AWS', folder: 'Study/AWS', examDate: null }],
		});
		tab.getSettingDefinitions();
		expect(getIndex).not.toHaveBeenCalled();
	});
});

describe('StudyCurveSettingTab.refreshIfShown', () => {
	/** 古い版の描き方（renderLegacy）と、1.13 以上の描き直し（update）を差し替えて、呼ばれた回数を数える */
	function spiedTab() {
		const { tab } = tabWith({ ...DEFAULT_SETTINGS, decks: [] });
		const renderLegacy = vi
			.spyOn(tab as unknown as { renderLegacy(): void }, 'renderLegacy')
			.mockImplementation(() => {});
		const update = vi.fn();
		tab.update = update;
		return { tab, renderLegacy, update };
	}

	afterEach(() => {
		stubApiVersion.current = '1.12.0';
	});

	it('1.13 以上では update で描き直す（display を呼び直しても描き直されないため）', () => {
		stubApiVersion.current = '1.13.0';
		const { tab, renderLegacy, update } = spiedTab();
		tab.refreshIfShown();
		expect(update).toHaveBeenCalledTimes(1);
		expect(renderLegacy).not.toHaveBeenCalled();
	});

	it('1.13 より古い版では、開いているときだけ今までどおり描き直す', () => {
		const { tab, renderLegacy, update } = spiedTab();
		tab.refreshIfShown();
		expect(renderLegacy).not.toHaveBeenCalled();

		tab.display();
		expect(renderLegacy).toHaveBeenCalledTimes(1);
		tab.refreshIfShown();
		expect(renderLegacy).toHaveBeenCalledTimes(2);

		tab.hide();
		tab.refreshIfShown();
		expect(renderLegacy).toHaveBeenCalledTimes(2);
		expect(update).not.toHaveBeenCalled();
	});
});
