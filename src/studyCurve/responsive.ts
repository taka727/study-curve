import { Component } from 'obsidian';

// 端末で分岐せず、実際に使える幅でレイアウトを決める。
// Pixel の縦画面も、iPad の分割表示も、Mac の狭いサイドバーも
// 「幅が狭い」という同じ条件として扱うことで、3端末で同じ見た目・同じ操作になる。
export const NARROW_WIDTH = 520;
export const COMPACT_WIDTH = 380;

export function applyWidthClasses(el: HTMLElement, width: number): void {
	// 初回描画時など幅が 0 で返ることがある。その場合は広い側として扱い、
	// 直後の ResizeObserver 通知で正しい幅に直す。
	el.toggleClass('is-narrow', width > 0 && width < NARROW_WIDTH);
	el.toggleClass('is-compact', width > 0 && width < COMPACT_WIDTH);
}

// クラスの付け外しだけで、再描画はしない（表示の出し分けは CSS 側に寄せてある）。
// リサイズや画面回転のたびに DOM を作り直さないので、モバイルでも引っかからない。
export function observeWidth(component: Component, el: HTMLElement): void {
	applyWidthClasses(el, el.clientWidth);
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) applyWidthClasses(el, entry.contentRect.width);
	});
	observer.observe(el);
	component.register(() => observer.disconnect());
}
