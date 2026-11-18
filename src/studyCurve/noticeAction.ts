/**
 * 通知の文言の後ろにボタンを付けた内容を作る（#5 の「取り消す」）。ボタンを押すと onClick を呼ぶ。
 * DOM のない環境（Node で動かすテスト）では、文言だけを返す
 */
export function messageWithAction(
	message: string,
	label: string,
	onClick: () => void,
): string | DocumentFragment {
	if (typeof createFragment !== 'function') return message;
	return createFragment((fragment) => {
		fragment.appendText(message);
		const button = fragment.createEl('button', { text: label, cls: 'study-curve-notice-action' });
		// クリックは通知まで伝わり、通知も閉じる（続けて押して二重に取り消そうとしないように）。
		// ボタンは通知と一緒に消えるので、リスナーを外す処理はいらない
		button.addEventListener('click', () => onClick());
	});
}
