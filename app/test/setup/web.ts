// 画面（React）のテストの共通の準備。jsdom のとき（`// @vitest-environment jsdom`）だけ、テストごとに、描いたものを片づける。
// jest-dom の matcher（toBeInTheDocument など）は、全部のテストで使える。
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
  // testing-library は、jsdom の環境でだけ読む（node の環境のテストで、document を要求しないように。ここだけ、動的に読む）
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());

  // jsdom に無いもの。jsdom は、レイアウトをしないので、何も通知・移動しない（測定・スクロールは、実際のブラウザで確かめる）
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') Element.prototype.scrollIntoView = () => {};
}
