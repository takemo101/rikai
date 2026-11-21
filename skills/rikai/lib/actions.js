'use strict';
// 画面（ブラウザ）からの操作：コメント・返信・回答・編集・削除・解決・Submit・終了。HTTP の POST /api/<名前> と同じ名前。
const fs = require('fs');
const path = require('path');
const { HttpError, now, writeJSON, str, normAnchor } = require('./util.js');
const { tdir, pageFile, mutate, nextId, listTopics, isSupported } = require('./store.js');
const { normAnswer } = require('./ask.js');
const { MAX_IMAGES, IMG_NAME_RE, decodeImage } = require('./image.js');

function findThread(th, id) {
  const t = th.threads.find((x) => x.id === id);
  if (!t) throw new HttpError(404, `スレッドがありません: ${id}`);
  return t;
}
function findUnsentUserMsg(t, id) {
  const m = t.messages.find((x) => x.id === id);
  if (!m || m.author !== 'user') throw new HttpError(404, 'メッセージがありません');
  if (m.sent) throw new HttpError(400, '送信済みのメッセージは変更できません');
  return m;
}

// 添付の画像の名前の一覧を検査する（形式・枚数・assets/ にあること）。名前は、サーバーが決めたもの（attach の返り値）だけを受ける
function normImages(slug, list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > MAX_IMAGES) throw new HttpError(400, `画像は ${MAX_IMAGES} 枚までです`);
  const names = [...new Set(list)];
  for (const n of names) {
    if (typeof n !== 'string' || !IMG_NAME_RE.test(n)) throw new HttpError(400, '画像の名前が不正です');
    if (!fs.existsSync(path.join(tdir(slug), 'assets', n))) throw new HttpError(400, '画像がありません');
  }
  return names;
}

// 解決の状態を変える（「解決」・「再開」・返信による再開で共通）。AI が最後に知っている状態と比べて、AI に送る変更かを決める。
// 知っている状態は、変更が未送信（resolveSent が false）ならいまの逆、送信済みならいまと同じ。
// 「解決」→「再開」のように元に戻したときは、送る変更にしない（何も変わっていないのに通知になるため）
function setResolved(t, want) {
  const known = t.resolveSent ? t.resolved : !t.resolved;
  t.resolved = want;
  t.resolveSent = want === known;
}

// 全トピックが閉じたときの動き。既定は何もしない。サーバーのプロセス（rikai serve）が、終了の処理を入れる。テストでも差し替える
const hooks = { allClosed: () => {} };

const actions = {
  // 画像を assets/ に保存し、名前を返す。名前は、中身から決める（同じ画像は、同じ名前＝重ならない）。ロックの下で書く
  attach(b) {
    const { buf, name } = decodeImage(b.data);
    return mutate(b.topic, (meta) => {
      const file = path.join(tdir(meta.slug), 'assets', name);
      if (!fs.existsSync(file)) {
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, file);
      }
      return { name };
    });
  },
  comment(b) {
    return mutate(b.topic, (meta, th) => {
      const pg = meta.pages[b.page];
      if (!pg) throw new HttpError(400, 'ページがありません');
      if (Number(b.version) !== pg.versions) throw new HttpError(400, '最新版にだけコメントできます');
      const text = str(b.text).trim();
      const images = normImages(meta.slug, b.images);
      if (!text && !images.length) throw new HttpError(400, 'コメントが空です');
      const t = {
        id: nextId(th, 't'), page: b.page, version: pg.versions, anchor: normAnchor(b.anchor),
        resolved: false, resolveSent: true, createdAt: now(), origin: 'user',
        messages: [{ id: nextId(th, 'm'), author: 'user', kind: 'comment', at: now(), text, ...(images.length ? { images } : {}), sent: false }],
      };
      th.threads.push(t);
      return { thread: t.id };
    });
  },
  reply(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const text = str(b.text).trim();
      const images = normImages(meta.slug, b.images);
      if (!text && !images.length) throw new HttpError(400, '返信が空です');
      if (t.resolved) setResolved(t, false);
      t.messages.push({ id: nextId(th, 'm'), author: 'user', kind: 'followup', at: now(), text, ...(images.length ? { images } : {}), sent: false });
      return {};
    });
  },
  answer(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const q = t.messages.find((m) => m.id === b.msg && m.author === 'ai' && m.ask);
      if (!q) throw new HttpError(404, '質問がありません');
      if (t.messages.some((m) => m.kind === 'answer' && m.to === q.id && m.sent)) throw new HttpError(400, '送信済みの回答は変えられません');
      const old = t.messages.find((m) => m.kind === 'answer' && m.to === q.id && !m.sent);
      if (b.answer == null) {
        if (old) t.messages.splice(t.messages.indexOf(old), 1);
        return {};
      }
      const answer = normAnswer(q.ask, b.answer);
      if (old) { old.answer = answer; old.at = now(); }
      else t.messages.push({ id: nextId(th, 'm'), author: 'user', kind: 'answer', at: now(), to: q.id, answer, sent: false });
      return {};
    });
  },
  edit(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const m = findUnsentUserMsg(t, b.msg);
      if (m.kind === 'answer') throw new HttpError(400, '回答は選び直してください');
      const text = str(b.text).trim();
      if (!text && !(m.images && m.images.length)) throw new HttpError(400, '空にはできません');
      m.text = text;
      return {};
    });
  },
  delete(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      const m = findUnsentUserMsg(t, b.msg);
      t.messages.splice(t.messages.indexOf(m), 1);
      if (!t.messages.length) th.threads.splice(th.threads.indexOf(t), 1);
      return {};
    });
  },
  resolve(b) {
    return mutate(b.topic, (meta, th) => {
      const t = findThread(th, b.thread);
      setResolved(t, !!b.resolved);
      return {};
    });
  },
  submit(b) {
    return mutate(b.topic, (meta, th) => {
      const compact = (m) => {
        const o = { id: m.id, author: m.author, kind: m.kind };
        for (const k of ['text', 'ask', 'answer', 'to', 'page', 'revision']) if (m[k] != null) o[k] = m[k];
        // 添付の画像は、AI が読めるよう、ファイルの絶対パスで渡す
        if (m.images && m.images.length) o.images = m.images.map((n) => path.join(tdir(meta.slug), 'assets', n));
        return o;
      };
      const items = [];
      const files = {};
      for (const t of th.threads) {
        const fresh = t.messages.filter((m) => m.author === 'user' && !m.sent);
        const resolveChange = t.resolveSent === false;
        if (!fresh.length && !resolveChange) continue;
        const pg = meta.pages[t.page];
        files[t.page] = { title: pg.title, version: pg.versions, file: pageFile(meta.slug, t.page, pg.versions) };
        items.push({
          thread: t.id, page: t.page, createdOnVersion: t.version, latestVersion: pg.versions,
          anchor: t.anchor ? { quote: t.anchor.quote, label: t.anchor.label, prefix: t.anchor.prefix, suffix: t.anchor.suffix } : null,
          ...(resolveChange ? { userMarked: t.resolved ? 'resolved' : 'reopened' } : {}),
          history: t.messages.filter((m) => !fresh.includes(m)).map(compact),
          new: fresh.map(compact),
        });
      }
      const note = str(b.note, 5000).trim();
      if (!items.length && !note) throw new HttpError(400, '送るコメントがありません');
      const round = ++meta.round;
      for (const t of th.threads) {
        for (const m of t.messages) if (m.author === 'user' && !m.sent) { m.sent = true; m.round = round; }
        t.resolveSent = true;
      }
      meta.pending = [...(meta.pending || []), round];
      const rec = { round, status: 'pending', submittedAt: now(), topic: meta.slug, ...(note ? { overallNote: note } : {}), pages: files, items };
      fs.mkdirSync(path.join(tdir(meta.slug), 'rounds'), { recursive: true });
      writeJSON(path.join(tdir(meta.slug), 'rounds', `${String(round).padStart(3, '0')}.json`), rec);
      return { round };
    });
  },
  end(b) {
    const r = mutate(b.topic, (meta) => { meta.closed = true; return {}; });
    // 読めない形のトピックは、閉じられないので、数えない（数えると、サーバーが終わらない）
    if (listTopics().filter(isSupported).every((t) => t.closed)) hooks.allClosed();
    return r;
  },
};

module.exports = { actions, hooks };
