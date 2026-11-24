// SSE（GET /api/events）の試験の道具：実際に待ち受けて、ストリームを読む。
import http from 'node:http';

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseClient {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** 届いたイベント（`event:`・`data:`）。コメント行（`: …`）は、comments */
  events: SseEvent[];
  comments: string[];
  /** 述語に合うイベントが届くまで待つ（すでに届いていてもよい）。時間内に届かなければ、null */
  waitFor(pred: (e: SseEvent) => boolean, ms?: number): Promise<SseEvent | null>;
  /** 一定時間、新しいイベントが来ないこと（来たら、それを返す） */
  quiet(ms: number): Promise<SseEvent | null>;
  /** 接続が終わった（サーバーが閉じた・自分で閉じた） */
  ended: Promise<void>;
  close(): void;
}

/** 接続する。状態が 200 でなければ、本文は読まず、status・headers だけ見られる（events は空） */
export function openEvents(
  port: number,
  headers: Record<string, string> = {},
  path = '/api/events',
): Promise<SseClient> {
  const { promise, resolve, reject } = Promise.withResolvers<SseClient>();
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const waiters = new Set<() => void>();
  const endedP = Promise.withResolvers<void>();
  const req = http.get({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buf += chunk;
      for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.startsWith(':')) {
          comments.push(block);
        } else {
          const ev: SseEvent = { event: '', data: '' };
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data += line.slice(6);
          }
          events.push(ev);
        }
      }
      for (const w of [...waiters]) w();
    });
    const finish = () => {
      endedP.resolve();
      for (const w of [...waiters]) w();
    };
    res.on('end', finish);
    res.on('close', finish);
    res.on('error', finish);
    if (res.statusCode !== 200) res.resume();
    const wait = (pred: (e: SseEvent) => boolean, ms: number, from: number): Promise<SseEvent | null> =>
      new Promise((done) => {
        const check = () => {
          const hit = events.slice(from).find(pred);
          if (hit) {
            cleanup();
            done(hit);
          }
        };
        const timer = setTimeout(() => {
          cleanup();
          done(null);
        }, ms);
        const cleanup = () => {
          clearTimeout(timer);
          waiters.delete(check);
        };
        waiters.add(check);
        check();
      });
    resolve({
      status: res.statusCode ?? 0,
      headers: res.headers,
      events,
      comments,
      waitFor: (pred, ms = 10_000) => wait(pred, ms, 0), // 上限だけ（満たされれば、すぐ返る）。負荷の下でも足りる長さ
      quiet: (ms) => wait(() => true, ms, events.length),
      ended: endedP.promise,
      close: () => req.destroy(),
    });
  });
  req.on('error', (e) => {
    endedP.resolve();
    reject(e);
  });
  return promise;
}

export const isChanged = (e: SseEvent): boolean => e.event === 'changed';
export const changed = (c: SseClient): unknown[] => c.events.filter(isChanged).map((e) => JSON.parse(e.data));
