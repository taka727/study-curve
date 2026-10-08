import { describe, expect, it } from 'vitest';
import { SettingsLoadSequencer } from '../src/settingsLoadSequencer';

// 設定の読み込みが重なったときの順番（#27。レビューの指摘：起動時の読み込みが同期の読み直しに追い越されると、
// 設定が入る前に onload が進んでいた）

/** 外から resolve・reject できる読み込み */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('SettingsLoadSequencer', () => {
	it('読み込みの最中は isLoading が true で、終わると結果を渡して false に戻る', async () => {
		const sequencer = new SettingsLoadSequencer();
		const read = deferred<string>();
		const applied: string[] = [];
		const running = sequencer.run(() => read.promise, (value) => applied.push(value));
		expect(sequencer.isLoading()).toBe(true);
		read.resolve('a');
		await running;
		expect(applied).toEqual(['a']);
		expect(sequencer.isLoading()).toBe(false);
	});

	it('先に始めた読み込みが先に終わっても結果は捨て、呼び出しは最後の読み込みが終わるまで返らない', async () => {
		const sequencer = new SettingsLoadSequencer();
		const first = deferred<string>();
		const second = deferred<string>();
		const applied: string[] = [];
		let firstReturned = false;
		const running1 = sequencer
			.run(() => first.promise, (value) => applied.push(value))
			.then(() => {
				firstReturned = true;
			});
		const running2 = sequencer.run(() => second.promise, (value) => applied.push(value));
		first.resolve('old');
		await flush();
		// 先の読み込みの結果は使わず、まだ読み込みの最中。先の呼び出しも返らない（起動の処理が進まない）
		expect(applied).toEqual([]);
		expect(sequencer.isLoading()).toBe(true);
		expect(firstReturned).toBe(false);
		second.resolve('new');
		await Promise.all([running1, running2]);
		expect(applied).toEqual(['new']);
		expect(firstReturned).toBe(true);
		expect(sequencer.isLoading()).toBe(false);
	});

	it('後から始めた読み込みが先に終われば、遅れて終わった古い読み込みで上書きしない', async () => {
		const sequencer = new SettingsLoadSequencer();
		const first = deferred<string>();
		const second = deferred<string>();
		const applied: string[] = [];
		const running1 = sequencer.run(() => first.promise, (value) => applied.push(value));
		const running2 = sequencer.run(() => second.promise, (value) => applied.push(value));
		second.resolve('new');
		await running2;
		expect(sequencer.isLoading()).toBe(false);
		first.resolve('old');
		await running1;
		expect(applied).toEqual(['new']);
		expect(sequencer.isLoading()).toBe(false);
	});

	it('3回重なっても、最後の結果だけを使う', async () => {
		const sequencer = new SettingsLoadSequencer();
		const reads = [deferred<string>(), deferred<string>(), deferred<string>()];
		const applied: string[] = [];
		const running = reads.map((read) => sequencer.run(() => read.promise, (v) => applied.push(v)));
		reads[0]!.resolve('1');
		reads[1]!.resolve('2');
		await flush();
		expect(sequencer.isLoading()).toBe(true);
		reads[2]!.resolve('3');
		await Promise.all(running);
		expect(applied).toEqual(['3']);
	});

	it('最後の読み込みが例外でも、読み込みの最中のままにしない', async () => {
		const sequencer = new SettingsLoadSequencer();
		const read = deferred<string>();
		const running = sequencer.run(() => read.promise, () => {});
		read.reject(new Error('読めません'));
		await expect(running).rejects.toThrow('読めません');
		expect(sequencer.isLoading()).toBe(false);
	});
});
