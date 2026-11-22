// 画面（ブラウザ）からの操作：コメント・返信・回答・編集・削除・解決・Submit・終了。HTTP の POST /api/<名前> と同じ名前。
// ストアと、フック（全トピックが閉じたときの動き）は、createActions の引数で渡す（モジュールの状態を持たない）。
import fs from 'node:fs';
import path from 'node:path';
import type {
  AnswerBody,
  AttachBody,
  CommentBody,
  DeleteBody,
  EditBody,
  EndBody,
  ReplyBody,
  ResolveBody,
  SubmitBody,
} from '../shared/api';
import type { Message, Round, RoundItem, RoundMessage, RoundPage, Thread, ThreadsFile } from '../shared/types';
import { normAnswer } from './ask';
import { decodeImage, IMG_NAME_RE, MAX_IMAGES } from './image';
import { isSupported, type Store } from './store';
import { HttpError, normAnchor, now, str, writeJSON } from './util';

/** 全トピックが閉じたときの動き。既定は何もしない。サーバーのプロセス（rikai serve）が、終了の処理を入れる。テストでも差し替える */
export interface ActionHooks {
  allClosed?: () => void;
}

function findThread(th: ThreadsFile, id: string): Thread {
  const t = th.threads.find((x) => x.id === id);
  if (!t) throw new HttpError(404, `スレッドがありません: ${id}`);
  return t;
}
function findUnsentUserMsg(t: Thread, id: string): Message {
  const m = t.messages.find((x) => x.id === id);
  if (m?.author !== 'user') throw new HttpError(404, 'メッセージがありません');
  if (m.sent) throw new HttpError(400, '送信済みのメッセージは変更できません');
  return m;
}

// 解決の状態を変える（「解決」・「再開」・返信による再開で共通）。AI が最後に知っている状態と比べて、AI に送る変更かを決める。
// 知っている状態は、変更が未送信（resolveSent が false）ならいまの逆、送信済みならいまと同じ。
// 「解決」→「再開」のように元に戻したときは、送る変更にしない（何も変わっていないのに通知になるため）
function setResolved(t: Thread, want: boolean): void {
  const known = t.resolveSent ? t.resolved : !t.resolved;
  t.resolved = want;
  t.resolveSent = want === known;
}

export function createActions(store: Store, hooks: ActionHooks = {}) {
  const { tdir, pageFile, mutate, nextId } = store;

  // 添付の画像の名前の一覧を検査する（形式・枚数・assets/ にあること）。名前は、サーバーが決めたもの（attach の返り値）だけを受ける
  function normImages(slug: string, list: unknown): string[] {
    if (list == null) return [];
    if (!Array.isArray(list) || list.length > MAX_IMAGES) throw new HttpError(400, `画像は ${MAX_IMAGES} 枚までです`);
    const names: unknown[] = [...new Set<unknown>(list)];
    for (const n of names) {
      if (typeof n !== 'string' || !IMG_NAME_RE.test(n)) throw new HttpError(400, '画像の名前が不正です');
      if (!fs.existsSync(path.join(tdir(slug), 'assets', n))) throw new HttpError(400, '画像がありません');
    }
    return names as string[];
  }

  return {
    // 画像を assets/ に保存し、名前を返す。名前は、中身から決める（同じ画像は、同じ名前＝重ならない）。ロックの下で書く
    attach(b: AttachBody): { name: string } {
      const { buf, name } = decodeImage(b.data);
      return mutate(b.topic, (meta) => {
        const file = path.join(tdir(meta.slug), 'assets', name);
        if (!fs.existsSync(file)) {
          fs.mkdirSync(path.dirname(file), { recursive: true }); // 空のフォルダは、git が持たない・手で消えることがある（submit の rounds/ と同じ）
          const tmp = `${file}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, buf);
          fs.renameSync(tmp, file);
        }
        return { name };
      });
    },
    comment(b: CommentBody): { thread: string } {
      return mutate(b.topic, (meta, th) => {
        const pg = meta.pages[b.page];
        if (!pg) throw new HttpError(400, 'ページがありません');
        if (Number(b.version) !== pg.versions) throw new HttpError(400, '最新版にだけコメントできます');
        const text = str(b.text).trim();
        const images = normImages(meta.slug, b.images);
        if (!text && !images.length) throw new HttpError(400, 'コメントが空です');
        const t: Thread = {
          id: nextId(th, 't'),
          page: b.page,
          version: pg.versions,
          anchor: normAnchor(b.anchor),
          resolved: false,
          resolveSent: true,
          createdAt: now(),
          origin: 'user',
          messages: [
            {
              id: nextId(th, 'm'),
              author: 'user',
              kind: 'comment',
              at: now(),
              text,
              ...(images.length ? { images } : {}),
              sent: false,
            },
          ],
        };
        th.threads.push(t);
        return { thread: t.id };
      });
    },
    reply(b: ReplyBody): Record<string, never> {
      return mutate(b.topic, (meta, th) => {
        const t = findThread(th, b.thread);
        const text = str(b.text).trim();
        const images = normImages(meta.slug, b.images);
        if (!text && !images.length) throw new HttpError(400, '返信が空です');
        if (t.resolved) setResolved(t, false);
        t.messages.push({
          id: nextId(th, 'm'),
          author: 'user',
          kind: 'followup',
          at: now(),
          text,
          ...(images.length ? { images } : {}),
          sent: false,
        });
        return {};
      });
    },
    answer(b: AnswerBody): Record<string, never> {
      return mutate(b.topic, (_meta, th) => {
        const t = findThread(th, b.thread);
        const q = t.messages.find((m) => m.id === b.msg && m.author === 'ai' && m.ask);
        if (!q?.ask) throw new HttpError(404, '質問がありません');
        if (t.messages.some((m) => m.kind === 'answer' && m.to === q.id && m.sent))
          throw new HttpError(400, '送信済みの回答は変えられません');
        const old = t.messages.find((m) => m.kind === 'answer' && m.to === q.id && !m.sent);
        if (b.answer == null) {
          if (old) t.messages.splice(t.messages.indexOf(old), 1);
          return {};
        }
        const answer = normAnswer(q.ask, b.answer);
        if (old) {
          old.answer = answer;
          old.at = now();
        } else
          t.messages.push({
            id: nextId(th, 'm'),
            author: 'user',
            kind: 'answer',
            at: now(),
            to: q.id,
            answer,
            sent: false,
          });
        return {};
      });
    },
    edit(b: EditBody): Record<string, never> {
      return mutate(b.topic, (_meta, th) => {
        const t = findThread(th, b.thread);
        const m = findUnsentUserMsg(t, b.msg);
        if (m.kind === 'answer') throw new HttpError(400, '回答は選び直してください');
        const text = str(b.text).trim();
        if (!text && !m.images?.length) throw new HttpError(400, '空にはできません');
        m.text = text;
        return {};
      });
    },
    delete(b: DeleteBody): Record<string, never> {
      return mutate(b.topic, (_meta, th) => {
        const t = findThread(th, b.thread);
        const m = findUnsentUserMsg(t, b.msg);
        t.messages.splice(t.messages.indexOf(m), 1);
        if (!t.messages.length) th.threads.splice(th.threads.indexOf(t), 1);
        return {};
      });
    },
    resolve(b: ResolveBody): Record<string, never> {
      return mutate(b.topic, (_meta, th) => {
        const t = findThread(th, b.thread);
        setResolved(t, !!b.resolved);
        return {};
      });
    },
    submit(b: SubmitBody): { round: number } {
      return mutate(b.topic, (meta, th) => {
        const compact = (m: Message): RoundMessage => {
          const o: RoundMessage = { id: m.id, author: m.author, kind: m.kind };
          const src = m as unknown as Record<string, unknown>;
          const dst = o as unknown as Record<string, unknown>;
          for (const k of ['text', 'ask', 'answer', 'to', 'page', 'revision']) if (src[k] != null) dst[k] = src[k];
          // 添付の画像は、AI が読めるよう、ファイルの絶対パスで渡す
          if (m.images?.length) o.images = m.images.map((n) => path.join(tdir(meta.slug), 'assets', n));
          return o;
        };
        const items: RoundItem[] = [];
        const files: Record<string, RoundPage> = {};
        for (const t of th.threads) {
          const fresh = t.messages.filter((m) => m.author === 'user' && !m.sent);
          const resolveChange = t.resolveSent === false;
          if (!fresh.length && !resolveChange) continue;
          const pg = meta.pages[t.page];
          files[t.page] = { title: pg.title, version: pg.versions, file: pageFile(meta.slug, t.page, pg.versions) };
          items.push({
            thread: t.id,
            page: t.page,
            createdOnVersion: t.version,
            latestVersion: pg.versions,
            anchor: t.anchor
              ? {
                  quote: t.anchor.quote,
                  label: t.anchor.label,
                  prefix: t.anchor.prefix,
                  suffix: t.anchor.suffix,
                  ...(t.anchor.rect ? { region: t.anchor.rect } : {}),
                }
              : null,
            ...(resolveChange ? { userMarked: t.resolved ? ('resolved' as const) : ('reopened' as const) } : {}),
            history: t.messages.filter((m) => !fresh.includes(m)).map(compact),
            new: fresh.map(compact),
          });
        }
        const note = str(b.note, 5000).trim();
        if (!items.length && !note) throw new HttpError(400, '送るコメントがありません');
        const round = ++meta.round;
        for (const t of th.threads) {
          for (const m of t.messages)
            if (m.author === 'user' && !m.sent) {
              m.sent = true;
              m.round = round;
            }
          t.resolveSent = true;
        }
        meta.pending = [...(meta.pending || []), round];
        const rec: Round = {
          round,
          status: 'pending',
          submittedAt: now(),
          topic: meta.slug,
          ...(note ? { overallNote: note } : {}),
          pages: files,
          items,
        };
        fs.mkdirSync(path.join(tdir(meta.slug), 'rounds'), { recursive: true });
        writeJSON(path.join(tdir(meta.slug), 'rounds', `${String(round).padStart(3, '0')}.json`), rec);
        return { round };
      });
    },
    end(b: EndBody): Record<string, never> {
      const r = mutate(b.topic, (meta) => {
        meta.closed = true;
        return {} as Record<string, never>;
      });
      // 読めない形のトピックは、閉じられないので、数えない（数えると、サーバーが終わらない）
      if (
        store
          .listTopics()
          .filter(isSupported)
          .every((t) => t.closed)
      )
        hooks.allClosed?.();
      return r;
    },
  };
}

export type Actions = ReturnType<typeof createActions>;
