// 実行できる枠（html-app）の中身の取り出し：資料から、n 番目のフェンスを、時間を切って取り出す。
// 結果・失敗・進行中の解析は、createAppFrames ごとの状態（モジュールの状態にしない。app.request() の試験が、互いに干渉しない）。
import fs from 'node:fs';
import { AppsError, appsOfAsync, DOC_MAX } from './htmlapp';
import type { Store } from './store';
import { HttpError } from './util';

// 枠の中身の取り出し：資料の字句解析は、別のスレッドで、時間を切って行う（AI が書いた資料は、非信頼。入れ子の箇条書きなどで、解析が、とても遅くなりうる）。
// 結果は、版ごとに覚える（版は変わらない。ファイルの更新時刻・大きさが変わったら、捨てる）。大きな結果は、覚えない。失敗（時間切れ・例外）も、60 秒、覚える
// （悪意のある資料が、枠を開くたびに、3 秒の worker を起こさないように）。同じ資料の、進行中の解析は、共有する。同時に動かす worker は、2 つまで
const APP_FAIL_MS = 60 * 1000;
const APP_WORKERS = 2;

type Stamp = { mtimeMs: number; size: number };
type Hit = (Stamp & { apps: string[]; error?: undefined }) | (Stamp & { error: string; at: number });
type Outcome = { apps: string[]; error?: undefined } | { error: string };

export interface AppFrames {
  /** 資料（トピック・ページ・版）の、html-app の中身の一覧。解析の失敗は、HttpError（413・422） */
  appsOfPage(slug: string, page: string, v: number): Promise<string[]>;
}

export function createAppFrames(store: Store): AppFrames {
  const cache = new Map<string, Hit>(); // `${トピック}/${ページ}/${版}` → { mtimeMs, size, apps } か { mtimeMs, size, error, at }
  const pending = new Map<string, Promise<Outcome>>(); // `${鍵}#${更新時刻}/${大きさ}` → 進行中の解析
  let workers = 0;
  const waiters: Array<() => void> = [];

  async function withWorkerSlot<T>(fn: () => Promise<T>): Promise<T> {
    while (workers >= APP_WORKERS) {
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push(resolve);
      await promise;
    }
    workers++;
    try {
      return await fn();
    } finally {
      workers--;
      waiters.shift()?.();
    }
  }

  async function appsOfPage(slug: string, page: string, v: number): Promise<string[]> {
    const file = store.pageFile(slug, page, v);
    const st = fs.statSync(file);
    if (st.size > DOC_MAX) throw new HttpError(413, '資料が大きすぎて、枠を取り出せません');
    const key = `${slug}/${page}/${v}`;
    const hit = cache.get(key);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
      if (hit.error === undefined) return hit.apps;
      if (Date.now() - hit.at < APP_FAIL_MS) throw new HttpError(422, hit.error);
    }
    const pendingKey = `${key}#${st.mtimeMs}/${st.size}`;
    let job = pending.get(pendingKey);
    if (!job) {
      job = withWorkerSlot(() => appsOfAsync(fs.readFileSync(file, 'utf8')))
        .then(
          (apps): Outcome => ({ apps }),
          (e: unknown): Outcome => ({
            error:
              e instanceof AppsError && e.reason === 'timeout'
                ? '資料が複雑すぎて、枠を取り出せません（時間切れ）'
                : '資料が複雑すぎて、枠を取り出せません',
          }),
        )
        .finally(() => pending.delete(pendingKey));
      pending.set(pendingKey, job);
    }
    const r = await job;
    const small = r.error !== undefined || r.apps.reduce((n, a) => n + a.length, 0) <= 1024 * 1024;
    if (small) {
      if (cache.size >= 32) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(
        key,
        r.error !== undefined
          ? { mtimeMs: st.mtimeMs, size: st.size, error: r.error, at: Date.now() }
          : { mtimeMs: st.mtimeMs, size: st.size, apps: r.apps },
      );
    }
    if (r.error !== undefined) throw new HttpError(422, r.error);
    return r.apps;
  }

  return { appsOfPage };
}
