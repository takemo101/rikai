// AI 向け：Submit された round を読む（peek・cmdPoll・cmdPull）、返信・新版・子ページを反映する（cmdApply）、状態を出す（cmdStatus）。
// プロジェクトは、createAgent(store) の引数で渡す（モジュールの状態を持たない）。
import fs from 'node:fs';
import path from 'node:path';
import { progressOf } from '../shared/progress'; // 画面と同じ数え方（理解の進み具合）
import type { Ask, Message, Round, Thread } from '../shared/types';
import { normAnchor } from './anchor';
import { normAsk } from './ask';
import { isSupported, SLUG_RE, type Store, schemaOf, topicTitle } from './store';
import { HttpError, now, out, readJSON, sleep, writeJSON } from './util';

/** peek の結果。status は、feedback（届いている）・closed（終了）・none（まだ）。round のレコードの status（pending / handled）とは別の語 */
export type PeekResult =
  | (Omit<Round, 'status'> & { status: 'feedback'; nextStep: string })
  | { status: 'closed'; unsent: number }
  | { status: 'none'; message: string; unsent: number };

export interface ApplyResult {
  ok: true;
  handledRounds: number[];
  newPages: string[];
  revised: Record<string, number>;
  repliedThreads: string[];
  newThreads: string[];
  unansweredThreads?: string[];
  warning?: string;
}

/** poll の引数（CLI の --timeout 秒） */
export interface PollFlags {
  timeout?: unknown;
}

// apply の入力は、AI が書く JSON。形は検査してから使うので、ここでは緩く持つ
type Loose = Record<string, unknown>;
// 検査したあとの ask（normAsk の結果）を持つ、入力の 1 件
type WithAsk = Loose & { ask: Ask | null };
const asArr = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : []);

/** AI 向けの操作（createAgent が返す） */
export interface Agent {
  listRounds(slug: string): Round[];
  peek(slug: string): PeekResult;
  cmdApply(slug: string, payload: unknown): ApplyResult;
  cmdPoll(slug: string, flags: PollFlags): Promise<void>;
  cmdPull(slug: string): void;
  cmdStatus(slug?: string): void;
}

export function createAgent(store: Store): Agent {
  const { tdir, pageFile, mutate, nextId, loadMeta, loadThreads, listTopics, countUnsent } = store;

  function listRounds(slug: string): Round[] {
    const dir = path.join(tdir(slug), 'rounds');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort()
      .map((f) => readJSON<Round | null>(path.join(dir, f), null))
      .filter((r): r is Round => !!r);
  }

  // Submit されたものがあるか。poll（待つ）と pull（待たない）が共有する。
  // 出力の status（feedback / closed / none）は、round のレコードの status（pending / handled）とは別の語なので、必ずレコードの後に置く
  function peek(slug: string): PeekResult {
    const meta = loadMeta(slug);
    const pend = listRounds(slug).find((r) => r.status === 'pending');
    if (pend)
      return {
        ...pend,
        status: 'feedback',
        nextStep:
          'コメントごとに返信し、rikai apply で反映する。Claude Code は、そのあと、もう一度 rikai poll をバックグラウンドで起動する',
      };
    if (meta.closed) return { status: 'closed', unsent: countUnsent(loadThreads(slug)) };
    return {
      status: 'none',
      message: 'まだ Submit されたコメントはありません',
      unsent: countUnsent(loadThreads(slug)),
    };
  }

  function cmdApply(slug: string, payload: unknown): ApplyResult {
    const P = (payload || {}) as Loose;
    return mutate(slug, (meta, th): ApplyResult => {
      const errs: string[] = [];
      const newPages = asArr(P.pages);
      const revisions = asArr(P.revisions);
      const replies = asArr(P.replies);
      const newThreads = asArr(P.threads);
      const known = new Set(Object.keys(meta.pages));
      const created = new Set<string>();
      const hasPage = (id: unknown) => known.has(id as string) || created.has(id as string);

      newPages.forEach((p, i) => {
        const w = `pages[${i}]`;
        if (!SLUG_RE.test(String(p.id || ''))) errs.push(`${w}.id は英小文字・数字・ハイフン`);
        else if (hasPage(p.id)) errs.push(`${w}.id が既存: ${p.id}`);
        if (!String(p.title || '').trim()) errs.push(`${w}.title が空`);
        if (!String(p.markdown || '').trim()) errs.push(`${w}.markdown が空`);
        const parent = p.parent || 'root';
        if (!hasPage(parent)) errs.push(`${w}.parent が存在しない: ${parent}`);
        if (SLUG_RE.test(String(p.id || ''))) created.add(p.id as string);
      });

      const revised: Record<string, number> = {};
      revisions.forEach((r, i) => {
        const w = `revisions[${i}]`;
        const page = r.page as string;
        if (!known.has(page)) errs.push(`${w}.page が既存ページではない: ${r.page}`);
        else if (revised[page]) errs.push(`${w}.page を1回の apply で2回直せない: ${r.page}`);
        else revised[page] = (meta.pages[page]?.versions as number) + 1;
        if (!String(r.markdown || '').trim()) errs.push(`${w}.markdown が空`);
      });

      const normReplies = replies.map((r, i): WithAsk => {
        const w = `replies[${i}]`;
        if (!th.threads.some((t) => t.id === r.thread)) errs.push(`${w}.thread が存在しない: ${r.thread}`);
        if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
        if (r.page != null && !hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
        return { ...r, ask: normAsk(r.ask, w, errs) };
      });
      const normNew = newThreads.map((r, i): WithAsk => {
        const w = `threads[${i}]`;
        if (!hasPage(r.page)) errs.push(`${w}.page が存在しない: ${r.page}`);
        if (!String(r.body || '').trim()) errs.push(`${w}.body が空`);
        if (r.link != null && !hasPage(r.link)) errs.push(`${w}.link が存在しない: ${r.link}`);
        return { ...r, ask: normAsk(r.ask, w, errs) };
      });

      const pendingRounds = listRounds(slug).filter((r) => r.status === 'pending');
      let handle = pendingRounds;
      if (P.round != null) {
        handle = pendingRounds.filter((r) => r.round === Number(P.round));
        if (!handle.length) errs.push(`round ${P.round} は未処理ではありません`);
      } else if (pendingRounds.length > 1) {
        // poll・pull が出すのは、いちばん古い round だけ。省略して全部を処理済みにすると、読んでいない round の発言に、返信せずに済ませてしまう
        errs.push(
          `未処理の round が複数あります（${pendingRounds.map((r) => r.round).join('・')}）。poll・pull が出すのは、いちばん古い round だけです。読んだ round を、round に指定して、1 つずつ処理してください`,
        );
      }
      if (errs.length) throw new HttpError(400, errs.join('\n'));

      // ここから書き込み
      for (const p of newPages) {
        const id = p.id as string;
        fs.mkdirSync(path.join(tdir(slug), 'pages', id), { recursive: true });
        fs.writeFileSync(pageFile(slug, id, 1), p.markdown as string);
        meta.pages[id] = {
          title: String(p.title).trim(),
          parent: (p.parent as string) || 'root',
          versions: 1,
          createdAt: now(),
        };
      }
      for (const r of revisions) {
        const pg = meta.pages[r.page as string];
        if (!pg) continue; // 検証済み（known にある）ので、ここには来ない
        pg.versions += 1;
        if (r.title) pg.title = String(r.title).trim();
        fs.writeFileSync(pageFile(slug, r.page as string, pg.versions), r.markdown as string);
      }
      const replied: string[] = [];
      for (const r of normReplies) {
        const t = th.threads.find((x) => x.id === r.thread) as Thread;
        const msg: Message = {
          id: nextId(th, 'm'),
          author: 'ai',
          kind: 'reply',
          at: now(),
          text: String(r.body),
          sent: true,
          ...(r.ask ? { ask: r.ask as Ask } : {}),
          ...(r.page ? { page: r.page as string } : {}),
          ...(revised[t.page] ? { revision: revised[t.page] } : {}),
        };
        t.messages.push(msg);
        replied.push(t.id);
      }
      const started: string[] = [];
      for (const r of normNew) {
        const pg = meta.pages[r.page as string] || { versions: 1 };
        const t: Thread = {
          id: nextId(th, 't'),
          page: r.page as string,
          version: pg.versions,
          anchor: normAnchor(r.anchor),
          resolved: false,
          resolveSent: true,
          createdAt: now(),
          origin: 'ai',
          messages: [
            {
              id: nextId(th, 'm'),
              author: 'ai',
              kind: 'reply',
              at: now(),
              text: String(r.body),
              sent: true,
              ...(r.ask ? { ask: r.ask as Ask } : {}),
              ...(r.link ? { page: r.link as string } : {}),
            },
          ],
        };
        th.threads.push(t);
        started.push(t.id);
      }
      const handledNos = handle.map((r) => r.round);
      const unanswered: string[] = [];
      for (const r of handle) {
        r.status = 'handled';
        r.handledAt = now();
        writeJSON(path.join(tdir(slug), 'rounds', `${String(r.round).padStart(3, '0')}.json`), r);
        // 返信が要るのは、新しい発言があるとき、または再開されたとき（「解決」だけの通知には、返信しなくてよい）
        for (const it of r.items)
          if (!replied.includes(it.thread) && (it.new.length || it.userMarked === 'reopened'))
            unanswered.push(it.thread);
      }
      meta.pending = (meta.pending || []).filter((n) => !handledNos.includes(n));
      return {
        ok: true,
        handledRounds: handledNos,
        newPages: [...created],
        revised,
        repliedThreads: replied,
        newThreads: started,
        ...(unanswered.length ? { unansweredThreads: unanswered, warning: '返信していないスレッドがあります' } : {}),
      };
    });
  }

  // ---------------------------------------------------------------- 出力するコマンド（CLI の poll / pull / status）

  async function cmdPoll(slug: string, flags: PollFlags): Promise<void> {
    const deadline = Date.now() + (Number(flags.timeout) || 43200) * 1000;
    for (;;) {
      const r = peek(slug);
      if (r.status !== 'none') return out(r);
      if (Date.now() > deadline) return out({ status: 'timeout' });
      await sleep(500);
    }
  }

  // 待機しない版。poll を使えないエージェントが、ユーザーに「送った」と言われたあとに読みに行く
  function cmdPull(slug: string): void {
    out(peek(slug));
  }

  function cmdStatus(slug?: string): void {
    const topics = slug ? [loadMeta(slug)] : listTopics();
    out(
      topics.map((m) => {
        if (!isSupported(m)) return { topic: m.slug, title: topicTitle(m), unsupported: true, schema: schemaOf(m) };
        const th = loadThreads(m.slug);
        return {
          topic: m.slug,
          title: m.title,
          closed: !!m.closed,
          pendingRounds: m.pending || [],
          unsentInBrowser: countUnsent(th),
          progress: progressOf(th.threads),
          pages: Object.fromEntries(
            Object.entries(m.pages).map(([id, p]) => [
              id,
              { title: p.title, parent: p.parent, versions: p.versions, file: pageFile(m.slug, id, p.versions) },
            ]),
          ),
        };
      }),
    );
  }

  return { listRounds, peek, cmdPoll, cmdPull, cmdApply, cmdStatus };
}
