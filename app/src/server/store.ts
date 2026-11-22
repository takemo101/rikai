// ストア：.rikai/<topic>/ の読み書き。変更は、すべて mutate を通す（ロック・検証してから書く）。
// プロジェクトのルートは、createStore(root) の引数で渡す（モジュールの状態を持たない）。
import fs from 'node:fs';
import path from 'node:path';
import { type Progress, progressOf } from '../shared/progress'; // 画面と同じ数え方（理解の進み具合）
import type { Meta, PageInfo, Thread, ThreadsFile } from '../shared/types';
import { HttpError, now, readJSON, sleepSync, writeJSON } from './util';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function checkSlug(s: unknown, what = 'トピック名'): string {
  if (!SLUG_RE.test(String(s || '')))
    throw new HttpError(400, `${what}は英小文字・数字・ハイフンで48字以内にしてください: ${s}`);
  return s as string;
}

// データ（meta.json）の形の版。形を変えるときは、ここを上げて、古い形を読み替える処理を足す（docs/development.md）。
// 版のない古い形は、版 1 として読む。このコードより新しい版は、読み書きを断る（新しい形を、古いコードが壊さないように）。
export const SCHEMA = 1;
/** 版だけを見る。読めない形のメタ（版が文字列など）も渡される */
export interface SchemaHolder {
  schema?: unknown;
}
export const schemaOf = (m: SchemaHolder): unknown => (m.schema === undefined ? 1 : m.schema);
export const isSupported = (m: SchemaHolder): boolean => {
  const v = schemaOf(m);
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= SCHEMA;
};

export const topicTitle = (m: { title?: unknown; slug?: unknown }): string =>
  typeof m.title === 'string' ? m.title : String(m.slug);

export interface Store {
  readonly root: string;
  readonly base: string;
  tdir(slug: string): string;
  serverFile(): string;
  ensureBase(): void;
  withLock<T>(slug: string, fn: () => T): T;
  loadMeta(slug: string): Meta;
  saveMeta(m: Meta): void;
  loadThreads(slug: string): ThreadsFile;
  saveThreads(slug: string, t: ThreadsFile): void;
  pageFile(slug: string, page: string, v: number): string;
  mutate<T>(slug: string, fn: (meta: Meta, th: ThreadsFile) => T): T;
  nextId(th: ThreadsFile, prefix: string): string;
  listTopics(): Meta[];
  countUnsent(th: ThreadsFile): number;
  topicState(slug: string): { rev: number; meta: Meta; threads: Thread[]; unsent: number };
  newTopic(slug: string, title: string, source: string, markdown: string): Meta;
  progressOrNull(slug: string): Progress | null;
}

export function countUnsent(th: ThreadsFile): number {
  let n = 0;
  for (const t of th.threads) {
    n += t.messages.filter((m) => m.author === 'user' && !m.sent).length;
    if (t.resolveSent === false) n += 1;
  }
  return n;
}

export const nextId = (th: ThreadsFile, prefix: string): string => `${prefix}${++th.seq}`;

export function createStore(root: string): Store {
  const base = path.join(root, '.rikai');

  function ensureBase(): void {
    fs.mkdirSync(base, { recursive: true });
    const gi = path.join(base, '.gitignore');
    // 既定ではコミットしない。共有したいときはこのファイルを消す
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  }

  const tdir = (slug: string): string => path.join(base, slug);
  const serverFile = (): string => path.join(base, '.server.json');

  function withLock<T>(slug: string, fn: () => T): T {
    const dir = path.join(tdir(slug), '.lock');
    const start = Date.now();
    for (;;) {
      try {
        fs.mkdirSync(dir);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          if (Date.now() - fs.statSync(dir).mtimeMs > 15000) fs.rmdirSync(dir);
        } catch {}
        if (Date.now() - start > 8000) throw new Error('ロックを取得できませんでした');
        sleepSync(30);
      }
    }
    try {
      return fn();
    } finally {
      try {
        fs.rmdirSync(dir);
      } catch {}
    }
  }

  function loadMeta(slug: string): Meta {
    checkSlug(slug);
    const m = readJSON<Meta | null>(path.join(tdir(slug), 'meta.json'), null);
    if (!m) throw new HttpError(404, `トピックがありません: ${slug}`);
    if (!isSupported(m)) {
      const v = schemaOf(m);
      // 新しい形式と、壊れた値は、直し方が違う（更新しても、壊れた値は直らない）
      if (Number.isInteger(v) && (v as number) > SCHEMA) {
        throw new HttpError(
          409,
          `このトピックは、この rikai が読めない新しい形式（データの版 ${v}）です。この rikai は、版 ${SCHEMA} までです。新しい rikai に更新してください（${slug}）`,
        );
      }
      throw new HttpError(
        409,
        `このトピックの meta.json の schema の値（${JSON.stringify(m.schema)}）が不正です。ファイルが壊れています（${slug}）`,
      );
    }
    return m;
  }
  function saveMeta(m: Meta): void {
    m.schema = SCHEMA;
    m.rev = (m.rev || 0) + 1;
    writeJSON(path.join(tdir(m.slug), 'meta.json'), m);
  }
  const loadThreads = (slug: string): ThreadsFile =>
    readJSON<ThreadsFile>(path.join(tdir(slug), 'threads.json'), { seq: 0, threads: [] });
  const saveThreads = (slug: string, t: ThreadsFile): void => writeJSON(path.join(tdir(slug), 'threads.json'), t);
  const pageFile = (slug: string, page: string, v: number): string => path.join(tdir(slug), 'pages', page, `v${v}.md`);

  // 変更はすべてここを通す。fn が投げたら何も書かない
  function mutate<T>(slug: string, fn: (meta: Meta, th: ThreadsFile) => T): T {
    loadMeta(slug); // 存在しないトピックは、ロックのフォルダを作る前に 404（作ろうとすると、内部エラーの 500 になる）
    return withLock(slug, () => {
      const meta = loadMeta(slug);
      const th = loadThreads(slug);
      const res = fn(meta, th);
      saveThreads(slug, th);
      saveMeta(meta);
      return res;
    });
  }

  function listTopics(): Meta[] {
    if (!fs.existsSync(base)) return [];
    const topics: Meta[] = [];
    for (const d of fs.readdirSync(base, { withFileTypes: true })) {
      if (!(d.isDirectory() && SLUG_RE.test(d.name) && fs.existsSync(path.join(base, d.name, 'meta.json')))) continue;
      const m = readJSON<Meta | null>(path.join(base, d.name, 'meta.json'), null);
      // 名前はディレクトリのものを使う（読めない形のメタの中身は、信用しない）
      if (m) topics.push({ ...m, slug: d.name });
    }
    return topics;
  }

  function topicState(slug: string) {
    const meta = loadMeta(slug);
    const th = loadThreads(slug);
    return { rev: meta.rev, meta, threads: th.threads, unsent: countUnsent(th) };
  }

  function newTopic(slug: string, title: string, source: string, markdown: string): Meta {
    checkSlug(slug);
    if (!String(markdown || '').trim()) throw new HttpError(400, '資料(Markdown)が空です。標準入力で渡してください');
    if (fs.existsSync(path.join(tdir(slug), 'meta.json'))) {
      throw new HttpError(409, `トピックは既にあります: ${slug}。版を進めるには apply の revisions を使ってください`);
    }
    ensureBase();
    for (const d of ['pages/root', 'assets', 'rounds']) fs.mkdirSync(path.join(tdir(slug), d), { recursive: true });
    fs.writeFileSync(pageFile(slug, 'root', 1), markdown);
    const rootPage: PageInfo = { title: String(title || slug), parent: null, versions: 1, createdAt: now() };
    const meta: Meta = {
      slug,
      title: String(title || slug),
      source: String(source || ''),
      createdAt: now(),
      rev: 0,
      round: 0,
      closed: false,
      pending: [],
      pages: { root: rootPage },
    };
    saveMeta(meta);
    saveThreads(slug, { seq: 0, threads: [] });
    return meta;
  }

  // 一覧に付ける、理解の進み具合。threads.json が壊れたトピックがあっても、一覧全体を 500 にしない（そのトピックは、数なし）。
  // 警告は、トピックごとに 1 回だけ。壊れたファイルの中身が、エラーの文に入ることがあるので、種類（name）だけを出す
  const warnedThreads = new Set<string>();
  function progressOrNull(slug: string): Progress | null {
    try {
      return progressOf(loadThreads(slug).threads);
    } catch (e) {
      if (!warnedThreads.has(slug)) {
        warnedThreads.add(slug);
        console.error(`threads.json を読めません（${slug}: ${(e as Error).name}）`);
      }
      return null;
    }
  }

  return {
    root,
    base,
    tdir,
    serverFile,
    ensureBase,
    withLock,
    loadMeta,
    saveMeta,
    loadThreads,
    saveThreads,
    pageFile,
    mutate,
    nextId,
    listTopics,
    countUnsent,
    topicState,
    newTopic,
    progressOrNull,
  };
}
