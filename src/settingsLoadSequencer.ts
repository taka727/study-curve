// 設定の読み込みが重なったときの順番を決める（#27）。Obsidian に依存しないので、テストで確かめられる。
// 同期のサービスによっては onExternalSettingsChange が続けて呼ばれ、読み込みが重なる。
// 真偽値の印だと、先に終わった読み込みが印を下ろして、まだ読んでいる最中に保存できてしまう。
// また、先に始めた読み込みが後から終わると、古い内容で上書きする。そこで番号で見分ける。

export class SettingsLoadSequencer {
	/** 始めた読み込みの番号 */
	private started = 0;
	/** 結果を使い終えた読み込みの番号。started と違えば読み込みの最中 */
	private finished = 0;
	/** 最後に始めた読み込み */
	private latest: Promise<void> = Promise.resolve();

	/** 読み込みの最中か（最後に始めた読み込みが終わっていない） */
	isLoading(): boolean {
		return this.started !== this.finished;
	}

	/**
	 * read で読み、終わった時点でこれが最後に始めた読み込みなら、その結果を apply に渡す。
	 * 先に始めた読み込みの結果は捨てる（古い内容で上書きしない）。どの呼び出しも、最後に始めた読み込みが
	 * 終わるまで待ってから返る（返った時点で、最新の設定が入っていることを呼び出し側が前提にできる。
	 * 起動時の読み込みが後の読み込みに追い越されても、設定が入る前に起動の処理が進まないように）
	 */
	async run<T>(read: () => Promise<T>, apply: (value: T) => void): Promise<void> {
		const seq = ++this.started;
		const own = (async () => {
			let value: T;
			try {
				value = await read();
			} catch (error) {
				if (seq === this.started) this.finished = seq;
				throw error;
			}
			if (seq !== this.started) return;
			try {
				apply(value);
			} finally {
				this.finished = seq;
			}
		})();
		this.latest = own;
		let current: Promise<void> = own;
		await current;
		// 待つ間に次の読み込みが始まっていたら、最後の読み込みが終わるまで待つ
		while (this.latest !== current) {
			current = this.latest;
			await current;
		}
	}
}
