// サーバーからの通知（SSE）の、ブラウザ全体で 1 本の接続を持つ SharedWorker（オリジンごとに 1 つ。タブの凍結・閉じるの影響を受けない）。
// 理由：Chrome は、HTTP/1.1 で、1 オリジンの接続を 6 本までしか開かない（タブ・窓をまたいで共有）。タブごとに SSE を 1 本持つと、6 タブで枠が埋まり、
// すべてのタブの取得・操作が止まる。ここだけが `EventSource('/api/events')` を持ち、つながっている全部のタブ（ポート）へ配る。
// タブ → ここ：`bye`（タブが閉じる・離れる）。ここ → タブ：`ready`・`changed`（本体は、受けた文字のまま）・`error`。
// 新しいタブがつながったら、いまの状態を、すぐ返す（`ready` なら、そのタブは、1 回取り直して、つながっている印を立てる）。
// ポートが 0 になったら、接続を閉じる（次のタブが、また開く）。タブの異常終了〔bye なし〕は、ポートが残るが、全部のタブが消えれば、ブラウザが、このワーカーを終える。
// 画面のコードを、import しない（バンドルが、重くならないように）。型だけ、events.ts と合わせる。

export type FromWorker = { type: 'ready' } | { type: 'changed'; data: string } | { type: 'error' };
export type ToWorker = { type: 'bye' };

const EVENTS_URL = '/api/events';

const ports = new Set<MessagePort>();
let es: EventSource | null = null;
/** いまの状態。ready：つながって、`ready` を受けた・error：切れた（再接続の途中）・connecting：まだ */
let state: 'connecting' | 'ready' | 'error' = 'connecting';

function broadcast(m: FromWorker): void {
  for (const p of ports) p.postMessage(m);
}

function open(): void {
  state = 'connecting';
  const src = new EventSource(EVENTS_URL);
  es = src;
  src.addEventListener('ready', () => {
    state = 'ready';
    broadcast({ type: 'ready' });
  });
  src.addEventListener('changed', (e) => broadcast({ type: 'changed', data: (e as MessageEvent<string>).data }));
  // EventSource は、自動で再接続する（そのたびに error）。タブは、状態が変わったときだけ、扱う
  src.addEventListener('error', () => {
    state = 'error';
    broadcast({ type: 'error' });
  });
}

function leave(port: MessagePort): void {
  if (!ports.delete(port)) return;
  port.close();
  if (ports.size === 0) {
    es?.close();
    es = null;
  }
}

(self as unknown as { onconnect: (e: MessageEvent) => void }).onconnect = (e) => {
  const port = e.ports[0] as MessagePort;
  ports.add(port);
  port.onmessage = (m: MessageEvent<ToWorker>) => {
    if (m.data.type === 'bye') leave(port);
  };
  if (!es) open();
  else if (state === 'ready') port.postMessage({ type: 'ready' } satisfies FromWorker);
  else if (state === 'error') port.postMessage({ type: 'error' } satisfies FromWorker);
};
