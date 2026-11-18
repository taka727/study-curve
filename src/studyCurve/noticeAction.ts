/**
 * 通知の文言の後ろにボタンを付けた内容を作る（#5 の「取り消す」）。ボタンを押すと onClick を呼ぶ
 * （戻り値は使わない。Promise を返してもよく、失敗の通知は onClick の側で出す）。
 * DOM のない環境（Node で動かすテスト）では、文言だけを返す
 */
export function messageWithAction(
	message: string,
	label: string,
	onClick: () => unknown,
): string | DocumentFragment {
	if (typeof createFragment !== 'function') return message;
	return createFragment((fragment) => {
		fragment.appendText(message);
		const button = fragment.createEl('button', { text: label, cls: 'study-curve-notice-action' });
		// クリックは通知まで伝わり、通知も閉じる（続けて押して二重に取り消そうとしないように）。
		// ボタンは通知と一緒に消えるので、リスナーを外す処理はいらない
		button.addEventListener('click', () => {
			void onClick();
		});
	});
}
