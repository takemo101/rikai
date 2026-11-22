// html-app：資料（Markdown）から、隔離した枠の中身を取り出す。取り出した中身は、`app.ts` が、隔離する CSP つきで配る（/appframe）。
// ここは、取り出すだけで、何も実行しない。
//
// 資料は、AI が書いた、非信頼のデータ。marked の字句解析は、入力によっては、とても遅い・深い入れ子で例外になる（40KB の入れ子の箇条書きで、数十秒以上）。
// サーバーのイベントループを止めないよう、**別のスレッド（worker）で解析し、時間を切る**（`appsOfAsync`）。
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export { appsOf, kindOf } from './htmlapp-core';

/** 1 つの枠の中身の上限（文字数） */
export const APP_MAX = 200 * 1024;
/** 解析する資料の上限（バイト） */
export const DOC_MAX = 4 * 1024 * 1024;
const TIMEOUT_MS = 3000;

/** 取り出しの失敗。reason：'timeout'（時間切れ）・'error'（例外・メモリ超過など） */
export class AppsError extends Error {
  constructor(
    message: string,
    readonly reason: 'timeout' | 'error',
  ) {
    super(message);
  }
}

type WorkerMessage = { ok: true; apps: string[] } | { ok: false; error: string };

// worker の入口（ビルド済みの JS）。バンドルの横（skills/rikai/）に置く。テストは、環境変数で、ビルドした場所を指す
const workerFile = (): string => process.env.RIKAI_HTMLAPP_WORKER || path.join(__dirname, 'rikai-htmlapp-worker.js');

/** worker で取り出す。時間（timeoutMs）を超えたら、worker を止めて、拒否する（reason：'timeout'）。例外（深すぎる入れ子など）も、拒否する */
export function appsOfAsync(markdown: unknown, timeoutMs = TIMEOUT_MS): Promise<string[]> {
  const { promise, resolve, reject } = Promise.withResolvers<string[]>();
  const w = new Worker(workerFile(), {
    workerData: { markdown: String(markdown || '') },
    resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 4 },
  });
  let done = false;
  const end = (fn: () => void): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    void w.terminate();
    fn();
  };
  const timer = setTimeout(() => end(() => reject(new AppsError('timeout', 'timeout'))), timeoutMs);
  w.once('message', (m: WorkerMessage) =>
    end(() => (m.ok ? resolve(m.apps) : reject(new AppsError(m.error, 'error')))),
  );
  w.once('error', (e) => end(() => reject(new AppsError(String(e?.message), 'error'))));
  w.once('exit', () => end(() => reject(new AppsError('exit', 'error'))));
  return promise;
}
