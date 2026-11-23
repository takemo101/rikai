// 変更の通知（SSE の元）：`.rikai/` の変化を、サーバーの中で見つけて、購読者へ知らせる。
// `rikai apply` は別のプロセスが `.rikai/` を直接書くので、サーバーは、ファイルを見るしかない：
// (1) `fs.watch`（再帰）で、早く気づく  (2) 一定間隔の確認（stat → 変わったものだけ meta.json の rev を読む）で、取りこぼし・OS の差に備える。
// どちらも、購読者が 1 人以上いる間だけ動く（0 人になれば、ウォッチャー・タイマーを解く）。状態は、createChangeFeed ごと（グローバルを持たない）。
// 送るのは「どのトピックの rev が何になったか」だけ。トピックごとに、rev が変わったときだけ通知する（同じ rev は、二重に送らない）。
// mutate は、threads.json のあとに meta.json（rev）を、rename で書く。rev が見えたときは、そのトピックの書き込みが済んでいる。
import fs from 'node:fs';
import path from 'node:path';
import type { ChangedEvent } from '../shared/api';
import { SLUG_RE, type Store } from './store';
import { readJSON } from './util';

export interface FeedOptions {
  /** `fs.watch` の差し替え。`null` なら使わない（確認の間隔だけで動く）。テストが、無効・失敗を作るためにも使う */
  watch?: typeof fs.watch | null;
  /** 確認の間隔（ミリ秒）。0 なら確認しない（`fs.watch` だけで動く） */
  pollMs?: number;
  /** 続けて起きた変化を、まとめる時間（ミリ秒）。最初の変化から、この時間のあとに 1 回だけ調べる */
  debounceMs?: number;
}

export interface ChangeFeed {
  /** 購読する。購読を解く関数を返す。最初の購読で、監視が始まり、最後の購読が解けると、止まる */
  subscribe(onChange: (e: ChangedEvent) => void): () => void;
  /** いまの購読の数 */
  readonly size: number;
}

/** トピックごとの、前に見た状態：meta.json の stat の印と、rev */
interface Seen {
  sig: string;
  rev: number;
}

export const POLL_MS = 300;
export const DEBOUNCE_MS = 30;

export function createChangeFeed(store: Store, opts: FeedOptions = {}): ChangeFeed {
  const watchFn = opts.watch === undefined ? fs.watch : opts.watch;
  const pollMs = opts.pollMs ?? POLL_MS;
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;

  const subs = new Set<(e: ChangedEvent) => void>();
  let known: Map<string, Seen> | null = null; // 監視中だけ持つ
  let watcher: fs.FSWatcher | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;

  /** いまのトピックの状態。前と同じ stat の印なら、読み直さない。読めない（書き込みの途中など）ものは、前の状態のまま */
  function snapshot(): Map<string, Seen> {
    const now = new Map<string, Seen>();
    let dirs: fs.Dirent[] = [];
    try {
      dirs = fs.readdirSync(store.base, { withFileTypes: true });
    } catch {}
    for (const d of dirs) {
      if (!(d.isDirectory() && SLUG_RE.test(d.name))) continue;
      const file = path.join(store.base, d.name, 'meta.json');
      const prev = known?.get(d.name);
      try {
        const st = fs.statSync(file);
        const sig = `${st.mtimeMs}:${st.size}:${st.ino}`;
        if (prev && prev.sig === sig) {
          now.set(d.name, prev);
          continue;
        }
        const m = readJSON<{ rev?: unknown } | null>(file, null);
        now.set(d.name, { sig, rev: typeof m?.rev === 'number' ? m.rev : 0 });
      } catch (e) {
        // meta.json がない（作る途中・トピックでない）は、いない扱い。読めない・壊れているものは、前のまま（次の確認で、また見る）
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && prev) now.set(d.name, prev);
      }
    }
    return now;
  }

  function emit(e: ChangedEvent): void {
    for (const onChange of [...subs]) onChange(e);
  }

  function scan(): void {
    if (!known) return;
    const before = known;
    const now = snapshot();
    known = now;
    // トピックの出入り（一覧の変化）→ 各トピックの rev
    let listChanged = before.size !== now.size;
    for (const slug of now.keys()) if (!before.has(slug)) listChanged = true;
    if (listChanged) emit({ topics: true });
    for (const [slug, s] of now) {
      const b = before.get(slug);
      if (b && b.rev !== s.rev) emit({ slug, rev: s.rev });
    }
  }

  function schedule(): void {
    if (pending || !known) return;
    pending = setTimeout(() => {
      pending = null;
      scan();
    }, debounceMs);
  }

  function start(): void {
    known = snapshot(); // 購読を始めた時点の状態。これより後の変化だけを、通知する
    if (watchFn) {
      try {
        // 再帰の監視：トピックの meta.json・threads.json の変化と、トピックの出入りに気づく。`.rikai/` がなくても、確認の間隔が見張る
        const w = watchFn(store.base, { recursive: true }, schedule);
        // 監視が壊れても（ディレクトリの削除など）、確認の間隔が続ける
        w.on('error', () => {
          w.close();
          if (watcher === w) watcher = null;
        });
        watcher = w;
      } catch {}
    }
    if (pollMs > 0) poller = setInterval(scan, pollMs);
  }

  function stop(): void {
    watcher?.close();
    watcher = null;
    if (poller) clearInterval(poller);
    poller = null;
    if (pending) clearTimeout(pending);
    pending = null;
    known = null;
  }

  return {
    subscribe(onChange) {
      subs.add(onChange);
      if (subs.size === 1) start();
      return () => {
        if (subs.delete(onChange) && subs.size === 0) stop();
      };
    },
    get size() {
      return subs.size;
    },
  };
}
