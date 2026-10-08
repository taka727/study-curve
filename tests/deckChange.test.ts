import { describe, expect, it } from 'vitest';
import {
	buildDeckRemoveConfirm,
	planDeckRename,
	renameHint,
	renameSubmitLabel,
} from '../src/studyCurve/deckChange';

// 設計書 §6.1 の表（#22 の完了条件2・8・9・10）

function plan(
	from: string,
	to: string,
	counts: Record<string, number> = {},
	otherDeckNames: string[] = [],
) {
	return planDeckRename({
		from,
		to,
		otherDeckNames,
		noteCounts: new Map(Object.entries(counts)),
	});
}

describe('planDeckRename・renameHint・renameSubmitLabel', () => {
	it('7. 名前を変えていなければ、書き換えも説明もなく「保存」', () => {
		const p = plan('A', 'A', { A: 55 });
		expect(p.rewriteCount).toBe(0);
		expect(renameHint(p)).toBeNull();
		expect(renameSubmitLabel(p)).toBe('保存');
	});

	it('8. 古い名前のノートの件数を書き換え、書き換えないもの（コードブロック、Templater）も伝える', () => {
		const p = plan('A', 'B', { A: 55 });
		expect(p).toMatchObject({ rewriteCount: 55, mergeCount: 0, sharedOldName: false });
		expect(renameHint(p)).toBe(
			'このデッキのノート 55 件の study-deck を「B」に書き換えます。コードブロック（study-today など）の deck: と、Templater の getDueQueue に書いた名前は書き換えません。',
		);
		expect(renameSubmitLabel(p)).toBe('保存して 55 件を書き換える');
	});

	it('9. 新しい名前のノートがすでにあれば、1つのデッキになることを伝える', () => {
		const p = plan('A', 'B', { A: 55, B: 3 });
		expect(p.mergeCount).toBe(3);
		expect(renameHint(p)).toContain('すでに「B」のノートが 3 件あり、1つのデッキになります。');
		expect(renameSubmitLabel(p)).toBe('保存して 55 件を書き換える');
	});

	it('10. 古い名前のノートが0件で、新しい名前のノートがあれば、そのノートがこのデッキになる', () => {
		const p = plan('A', 'B', { B: 3 });
		expect(p.rewriteCount).toBe(0);
		expect(renameHint(p)).toBe('「B」のノート 3 件が、このデッキのノートになります。');
		expect(renameSubmitLabel(p)).toBe('保存');
	});

	it('11. 古い名前のデッキが設定にもう1つあれば、ノートは書き換えない', () => {
		const p = plan('A', 'B', { A: 55 }, ['A']);
		expect(p).toMatchObject({ rewriteCount: 0, sharedOldName: true });
		expect(renameHint(p)).toBe('同じ名前「A」のデッキがほかにもあるため、ノートは書き換えません。');
		expect(renameSubmitLabel(p)).toBe('保存');
	});

	it('12. 大文字と小文字だけの変更も、名前の変更として書き換える', () => {
		expect(plan('aws', 'AWS', { aws: 2 }).rewriteCount).toBe(2);
	});

	it('13. どちらのノートもなければ、説明なしで「保存」', () => {
		const p = plan('A', 'B');
		expect(p.rewriteCount).toBe(0);
		expect(renameHint(p)).toBeNull();
		expect(renameSubmitLabel(p)).toBe('保存');
	});

	// agy-review の指摘：保存できない入力の途中に、書き換えや1つになることを見せない
	it('名前を空にした途中では、書き換えの説明を出さず「保存」', () => {
		const p = plan('A', '', { A: 55 });
		expect(p.rewriteCount).toBe(0);
		expect(renameHint(p)).toBeNull();
		expect(renameSubmitLabel(p)).toBe('保存');
	});

	it('設定のほかのデッキと同じ名前（保存できない）なら、書き換えや1つになる説明を出さず「保存」', () => {
		const p = plan('A', 'B', { A: 55, B: 3 }, ['B']);
		expect(p).toMatchObject({ rewriteCount: 0, mergeCount: 0, sharedOldName: false });
		expect(renameHint(p)).toBeNull();
		expect(renameSubmitLabel(p)).toBe('保存');
	});
});

// 設計書 §6.1 の表（#25 の完了条件2・3・4）

describe('buildDeckRemoveConfirm', () => {
	const paths = (count: number, folder = 'deck') =>
		Array.from({ length: count }, (_, i) => `${folder}/n${i}.md`);

	it('7. ノートが0件なら「削除」だけ（赤）', () => {
		const { options, unenrollLabel } = buildDeckRemoveConfirm({
			deckName: 'E',
			deckFolder: '',
			notePaths: [],
			sharedName: false,
		});
		expect(options).toEqual({
			title: 'デッキを削除',
			message: '「E」を設定から削除します。このデッキのノートはありません。',
			confirmLabel: '削除',
			warning: true,
		});
		expect(unenrollLabel).toBeNull();
	});

	it('8. ノートがあれば「残して削除」（青）と「外して削除」から選ぶ', () => {
		const { options, unenrollLabel } = buildDeckRemoveConfirm({
			deckName: 'A',
			deckFolder: 'deck',
			notePaths: paths(3),
			sharedName: false,
		});
		expect(options.message).toContain('「A」を設定から削除します。このデッキのノートが 3 件あります。');
		expect(options.message).toContain('ステージと履歴は元に戻せません。');
		expect(options.details).toEqual(['n0', 'n1', 'n2']);
		expect(options.moreCount).toBe(0);
		expect(options.confirmLabel).toBe('ノートを残して削除');
		expect(options.warning).toBe(false);
		expect(unenrollLabel).toBe('3 件を復習対象から外して削除');
	});

	it('9. 一覧は先頭5件で、残りは「ほか N 件」', () => {
		const { options } = buildDeckRemoveConfirm({
			deckName: 'A',
			deckFolder: 'deck',
			notePaths: paths(124),
			sharedName: false,
		});
		expect(options.details).toHaveLength(5);
		expect(options.moreCount).toBe(119);
	});

	it('10. 同じ名前のデッキがほかにもあれば、ノートはそのまま残ることを書き、「削除」だけ', () => {
		const { options, unenrollLabel } = buildDeckRemoveConfirm({
			deckName: 'A',
			deckFolder: 'deck',
			notePaths: paths(55),
			sharedName: true,
		});
		expect(options.message).toBe(
			'「A」を設定から削除します。同じ名前のデッキがほかにもあるため、ノート 55 件はそのデッキのまま残ります。',
		);
		expect(options.confirmLabel).toBe('削除');
		expect(options.warning).toBe(true);
		expect(options.details).toBeUndefined();
		expect(unenrollLabel).toBeNull();
	});

	it('11. 一覧はデッキのフォルダからの相対パスで、.md を除く', () => {
		const { options } = buildDeckRemoveConfirm({
			deckName: 'AWS DOP',
			deckFolder: 'AWS/DOP',
			notePaths: ['AWS/DOP/review/a.md'],
			sharedName: false,
		});
		expect(options.details).toEqual(['review/a']);
	});

	it('12. 名前が空なら「（名前なし）」', () => {
		const { options } = buildDeckRemoveConfirm({
			deckName: '',
			deckFolder: '',
			notePaths: [],
			sharedName: false,
		});
		expect(options.message).toContain('「（名前なし）」');
	});
});
