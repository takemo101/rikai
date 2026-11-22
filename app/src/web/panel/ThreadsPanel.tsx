// 右のパネル（`<aside id="threads">`）：見出し・切り替え（進行中・解決済み・すべて）・固定の上部・新しいコメントの入力欄・スレッドのカード・解決済みの 1 行・
// 番号で 1 枚だけ見る（solo）。ライトボックス（`#lightbox`）も、ここが出す（旧 index.html の置き場）。
// 描き直しても、入力欄のフォーカス・選択範囲・パネルのスクロールは、そのまま：カードは、キーで、同じ DOM を使い回す（旧は、毎回、作り直して、戻していた）。
// 入力欄が、並びの中で動いても、React が、フォーカスと選択範囲を、戻す。スクロールの位置は、ここ（useKeepScroll）が、戻す。

import { ArrowLeft, ChevronRight, Spline } from 'lucide-react';
import {
  type MouseEvent,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type { Thread } from '../../shared/types';
import { type TopicState, topicKey } from '../api/queries';
import { queryClient } from '../api/queryClient';
import type { ThreadsPanelProps } from '../contracts';
import { trunc } from '../lib/dom';
import type { View } from '../lib/view';
import { type DocModel, docOrder, locEl, useDoc } from '../store/doc';
import { type Tab, useUi } from '../store/ui';
import { Composer } from './Composer';
import { Lightbox } from './Lightbox';
import { composerSlot, lastSpeech, quoteOf } from './logic';
import { type PanelActions, PanelContext, usePanel } from './panelContext';
import { ThreadCard } from './ThreadCard';
import { preventFileDropOutside } from './useImageAttach';

const EMPTY_HINT =
  '本文の文を選ぶと「コメント」が出ます。ブロックにマウスを置くと出るバーの「コメント」でも、付けられます。本文の好きな範囲は、右下の「範囲を選ぶ」から、ドラッグで選べます。';

export function ThreadsPanel({ view }: ThreadsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const [scrollReq, setScrollReq] = useState<{ tid: string; until: number } | null>(null);

  useEffect(preventFileDropOutside, []);

  // 見つけたカードを、パネルの見える所へ。カードが、まだ描かれていない（取り直したスレッドが、届く前）なら、描き直すたびに、探す（一定の時間だけ）
  useEffect(() => {
    if (!scrollReq) return;
    if (Date.now() > scrollReq.until) {
      setScrollReq(null);
      return;
    }
    const card = [...(panelRef.current?.querySelectorAll<HTMLElement>('.thread[data-tid]') ?? [])].find(
      (c) => c.dataset.tid === scrollReq.tid,
    );
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setScrollReq(null);
  });

  // 本文から選ばれた（番号・強調を押した：呼ぶ側は、ストアの focusThread だけ）ときも、カードを、見える所へ（旧の focusThread は、押すたびに）。
  // 連番で見る：選んでいるものを、もう一度選んでも、戻す。カードの見出しを押したときは、動かすのは、本文：カードは、動かさない
  const focusSeq = useUi((s) => s.focusSeq);
  const docFocus = useRef<{ tid: string; at: number } | null>(null);
  useEffect(() => {
    const active = useUi.getState().active;
    if (!active || focusSeq === 0) return;
    const d = docFocus.current;
    if (d && d.tid === active && Date.now() - d.at < 1000) return;
    setScrollReq({ tid: active, until: Date.now() + 3000 });
  }, [focusSeq]);

  const slug = view?.slug ?? null;
  const focusThread = useCallback(
    (tid: string, scrollDoc: boolean): void => {
      // 操作のあとの取り直しが済んだ、いちばん新しいスレッドから（props の view は、描き直しの前のもの）
      const fresh = slug ? queryClient.getQueryData<TopicState>(topicKey(slug)) : undefined;
      const t = fresh?.threads.find((x) => x.id === tid);
      const ui = useUi.getState();
      if (scrollDoc) docFocus.current = { tid, at: Date.now() };
      if (t) ui.focusThread(t);
      else ui.setActive(tid);
      if (scrollDoc)
        locEl(useDoc.getState().model?.locs.get(tid))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else setScrollReq({ tid, until: Date.now() + 3000 });
    },
    [slug],
  );

  // コメントを追加した：追加したカードが、画面に届いたときに、入力欄を閉じて、カードを選ぶ
  const [, rerender] = useState(0);
  const added = useRef<{ tid: string; composerId: number } | null>(null);
  const finishAdd = useCallback(
    (tid: string): void => {
      const a = added.current;
      if (a?.tid !== tid) return;
      added.current = null;
      const s = useUi.getState();
      if (s.composer?.id === a.composerId) s.closeComposer(); // 通信中に開き直した入力欄は、閉じない
      s.closeSolo(); // 1 枚だけ見ていても、足したコメントが見えるように、一覧へ戻す
      if (s.tab === 'done') s.setTab('live');
      focusThread(tid, false);
    },
    [focusThread],
  );
  const actions = useMemo<PanelActions>(
    () => ({
      focusThread,
      afterComment: (tid, composerId) => {
        added.current = { tid, composerId };
        rerender((n) => n + 1);
        setTimeout(() => finishAdd(tid), 4000); // カードが、届かなくても（別のページへ移った）、入力欄は、閉じる
      },
    }),
    [focusThread, finishAdd],
  );
  const arrived = added.current !== null && !!view?.topic.threads.some((t) => t.id === added.current?.tid);
  useLayoutEffect(() => {
    if (arrived && added.current) finishAdd(added.current.tid);
  });

  return (
    <PanelContext.Provider value={actions}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: サムネイルの画像の押下を、パネル全体で受ける（旧と同じ。画像は、押す前提のマウス操作） */}
      <aside id="threads" ref={panelRef} onClick={openLightboxOnImage}>
        {view ? <Threads view={view} panelRef={panelRef} /> : null}
      </aside>
      <Lightbox />
    </PanelContext.Provider>
  );
}

/** 添付の画像（サムネイル・送った画像）を押すと、ライトボックスで大きく出す */
function openLightboxOnImage(e: MouseEvent<HTMLElement>): void {
  if (!(e.target instanceof Element)) return;
  const img = e.target.closest('.thumb img, .msg .imgs img');
  if (!(img instanceof HTMLImageElement)) return;
  e.preventDefault();
  useUi.getState().openLightbox(img.src);
}

// ---- スクロールの位置を戻す（旧 renderThreads の、描き直しの前後） ----

/**
 * 描くとき（DOM が、まだ前のまま）に、パネルのスクロールの位置を覚え、描いたあとに戻す。
 * カードを組み替える途中で、ブラウザが、レイアウトを計算すると（中身が、一時的に、短くなる）、位置が、0 などに詰められて、戻らないため。
 * 戻すのは、変わっていたときだけ（スムーズなスクロールの途中を、止めない）。フォーカスと選択範囲は、React が、戻す
 */
function useKeepScroll(ref: RefObject<HTMLElement | null>): void {
  const kept = useRef(0);
  if (ref.current) kept.current = ref.current.scrollTop;
  useLayoutEffect(() => {
    const panel = ref.current;
    if (panel && panel.scrollTop !== kept.current) panel.scrollTop = kept.current;
  });
}

// ---- パネルの中身 ----

/** 本文のモデル。別のページ・版の古いものは、使わない */
function useModelFor(view: View): DocModel | null {
  const model = useDoc((s) => s.model);
  return model && model.key === view.key ? model : null;
}

// memo：選んだ・カードへ動かす（ThreadsPanel の状態）だけでは、描き直さない（見たものの一覧は、描き直すときの値のまま：旧と同じ）
const Threads = memo(function Threads({ view, panelRef }: { view: View; panelRef: RefObject<HTMLElement | null> }) {
  useKeepScroll(panelRef);
  const model = useModelFor(view);
  const tab = useUi((s) => s.tab);
  const soloId = useUi((s) => s.solo);
  const composer = useUi((s) => s.composer);
  const rowOpen = useUi((s) => s.rowOpen);
  const setTab = useUi((s) => s.setTab);
  const closeSolo = useUi((s) => s.closeSolo);
  const editing = useUi((s) => s.editing);
  const links = useUi((s) => s.ui.links);
  // 見たものの一覧は、ここで読む（購読しない）：見たことになっても、パネルは、描き直さない。描き直すときの値を、カードに渡す
  const seen = useUi.getState().seen;

  const list = view.topic.threads.filter((t) => t.page === view.page);
  const order = (a: Thread, b: Thread): number => docOrder(model, a.id, b.id);
  const live = list.filter((t) => !t.resolved).sort(order);
  const done = list.filter((t) => t.resolved).sort(order);

  // 別のページ・版へ移った：1 枚だけ見ている状態を解く（その間は、一覧として描く）
  const solo = soloId ? list.find((t) => t.id === soloId) : undefined;
  useEffect(() => {
    if (soloId && !solo) closeSolo();
  }, [soloId, solo, closeSolo]);

  const pending = model?.pending ?? null;
  const composerNode = composer ? <Composer key="composer" view={view} composer={composer} pending={pending} /> : null;
  const num = (t: Thread): number | undefined => model?.nums.get(t.id);

  const top: ReactNode[] = [
    <div className="side-h panel-h" key="h">
      コメント
      <button
        id="links-toggle"
        type="button"
        className="iconbtn"
        title="関連の線：コメントと、本文の対象を、線で結ぶ"
        aria-label="関連の線を出す"
        aria-pressed={links}
        onClick={() => useUi.getState().toggleLinks()}
      >
        <Spline aria-hidden="true" focusable="false" />
      </button>
    </div>,
  ];
  const body: ReactNode[] = [];

  if (solo) {
    // 本文の番号を押した：そのカードだけを、古いやり取りもたたまずに見せる
    const n = num(solo);
    top.push(
      <div className="solobar" key="solo">
        <button type="button" className="link" onClick={closeSolo}>
          <ArrowLeft aria-hidden="true" focusable="false" />
          すべてのコメントに戻る
        </button>
        <span className="hint">{n !== undefined ? `${n} 番のコメントだけを表示中` : 'このコメントだけを表示中'}</span>
      </div>,
    );
    if (composerNode) body.push(composerNode);
    body.push(<ThreadCard key={solo.id} view={view} thread={solo} full model={model} seen={seen} editing={editing} />);
  } else {
    if (!list.length && !composer)
      body.push(
        <div className="empty" key="empty">
          {EMPTY_HINT}
        </div>,
      );
    if (list.length) {
      const tabs: [Tab, string, number][] = [
        ['live', '進行中', live.length],
        ['done', '解決済み', done.length],
        ['all', 'すべて', list.length],
      ];
      top.push(
        <div className="tabs" role="tablist" key="tabs">
          {tabs.map(([k, label, n]) => (
            <button
              type="button"
              role="tab"
              className={`tab${tab === k ? ' on' : ''}`}
              aria-selected={tab === k}
              key={k}
              onClick={() => setTab(k)}
            >
              {label}
              <span className="n">{String(n)}</span>
            </button>
          ))}
        </div>,
      );
    }
    const showLive = tab !== 'done';
    const showDone = tab !== 'live';
    // 入力欄は、対象の位置の順に、スレッドの間へ入れる（いつも一番上、にしない）。進行中を出さない切り替えのときは、一番上
    const slot = composerSlot(live, !!composer, pending, (tid) => locEl(model?.locs.get(tid)));
    if (showLive) {
      live.forEach((t, i) => {
        if (i === slot && composerNode) body.push(composerNode);
        body.push(<ThreadCard key={t.id} view={view} thread={t} model={model} seen={seen} editing={editing} />);
      });
      if (composerNode && slot >= live.length) body.push(composerNode);
      if (!live.length && list.length && tab === 'live')
        body.push(
          <div className="empty" key="empty-live">
            進行中のコメントは、ありません。
          </div>,
        );
    } else if (composerNode) body.push(composerNode);
    if (showDone) {
      for (const t of done)
        body.push(
          rowOpen.has(t.id) ? (
            <OpenRow key={t.id} view={view} thread={t} model={model} seen={seen} editing={editing} />
          ) : (
            <DoneRow key={t.id} thread={t} num={num(t)} />
          ),
        );
      if (!done.length && tab === 'done')
        body.push(
          <div className="empty" key="empty-done">
            解決済みのコメントは、ありません。
          </div>,
        );
    }
  }

  return (
    <>
      <div className="panel-top">{top}</div>
      {body}
    </>
  );
});

/** 解決済みを、開いて見せる（「一覧の 1 行に戻す」つき） */
function OpenRow({
  view,
  thread,
  model,
  seen,
  editing,
}: {
  view: View;
  thread: Thread;
  model: DocModel | null;
  seen: ReadonlySet<string>;
  editing: string | null;
}) {
  const setRowOpen = useUi((s) => s.setRowOpen);
  return (
    <div className="rowopen">
      <ThreadCard view={view} thread={thread} model={model} seen={seen} editing={editing} />
      <button type="button" className="link" onClick={() => setRowOpen(thread.id, false)}>
        一覧の 1 行に戻す
      </button>
    </div>
  );
}

/** 解決済みのスレッドは、1 行（番号・対象・最後の発言のはじめ）で見せる。押すと、カードが開く */
function DoneRow({ thread: t, num }: { thread: Thread; num: number | undefined }) {
  const setRowOpen = useUi((s) => s.setRowOpen);
  const { focusThread } = usePanel();
  return (
    <button
      type="button"
      className="donerow"
      data-tid={t.id}
      title="押すと、このコメントが開きます"
      onClick={() => {
        // 開いて、描いてから、選ぶ（見たことにする）：開いた直後の発言に、「新着」の印が、残る（旧と同じ順）
        flushSync(() => setRowOpen(t.id, true));
        focusThread(t.id, false);
      }}
    >
      {num !== undefined ? <span className="no resolved">{String(num)}</span> : null}
      <span className="dr-q">{trunc(quoteOf(t), 30)}</span>
      <span className="dr-last">{lastSpeech(t)}</span>
      <ChevronRight aria-hidden="true" focusable="false" />
    </button>
  );
}
