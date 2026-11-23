// 本文（`<article id="article" class="md">`）。**命令的な島**：子を持たない要素で出し、中身は、`render/renderDoc.ts` が DOM を作って `replaceChildren` する。React は、中身を触らない。
// 描き終えたら、DocModel（どのブロック・強調・番号が、どこにあるか）を、`useDoc` へ入れる（パネル・番号の層・入口のバーが読む）。
import { useEffect, useRef } from 'react';
import { type PickInfo, pickDraft, stateDraft } from '../../shared/htmlapp-bridge';
import type { ArticleProps } from '../contracts';
import { $$ } from '../lib/dom';
import { type BlockEl, type DocModel, locEl, nextEpoch, useDoc } from '../store/doc';
import { toast, useUi } from '../store/ui';
import { latestStateOf, releaseApps } from './appBridge';
import { articleTid } from './hit';
import { blockAnchor } from './render/blocks';
import { FOCUS_ENTRY, mediaOfEntry } from './render/focusable';
import { markPending } from './render/highlights';
import { renderDoc } from './render/renderDoc';
import { noteMouseDown, openFocusApp, openFocusOf, zoomOnClick } from './zoomOpen';

/** 選んでいるスレッドの、本文の強調に、`.active` を付ける（付けなおす） */
function applyActive(art: HTMLElement, tid: string | null): void {
  for (const e of $$('.hl.active, .blk-thread.active', art)) e.classList.remove('active');
  if (!tid) return;
  for (const e of $$<BlockEl>('[data-tid]', art)) if (e.dataset.tid === tid) e.classList.add('active');
}

/** 描き直しても、いま光らせているもの（`linkedTid`）は、光ったままにする（光らせるのは、W3 の hoverLink。描き直しで、印の要素が作り直されるため、付け直す） */
function applyLinked(art: HTMLElement, model: DocModel, tid: string | null): void {
  if (!tid) return;
  for (const e of $$<BlockEl>('[data-tid]', art)) if (e.dataset.tid === tid) e.classList.add('linked');
  locEl(model.locs.get(tid))?.classList.add('linked'); // 1 つのブロックに複数のコメントがあるとき、data-tid は、最後の 1 つだけ。位置は、ここから取る
}

/** 入力欄を開いたあと：入力欄へフォーカスを移し、選択を外す */
function focusComposer(): void {
  getSelection()?.removeAllRanges();
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-key="composer"]')?.focus();
    document.querySelector('.thread.composer')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

/** 「この枠にコメント」：枠を対象に、入力欄を開く（開けたら、入力欄へフォーカスを移し、選択を外す）。枠が、`rikai.state(obj)` で知らせた状態があれば、本文に添える（F42） */
function commentOn(box: BlockEl): void {
  if (!useUi.getState().startComposer(blockAnchor(box), stateDraft(latestStateOf(box)) ?? undefined)) return;
  focusComposer();
}

/** 利用者が、枠の中の要素を選んだ（枠から届いて、検査を通ったもの）：その枠への下書きを作る。本文には、「【枠から】」の 1 行と、JSON のブロック。送るのは、利用者（自動では、送らない） */
function pickOn(box: BlockEl, pick: PickInfo, stateJson: string | null): void {
  const d = pickDraft(pick, stateJson);
  if (!useUi.getState().startComposer({ ...blockAnchor(box), label: d.label }, d.text)) return;
  focusComposer();
}

export function Article({ view, markdown, prevMarkdown }: ArticleProps) {
  const ref = useRef<HTMLElement>(null);
  const showChanges = useUi((s) => s.showChanges);
  const active = useUi((s) => s.active);
  const composerId = useUi((s) => s.composer?.id ?? null);

  const threads = view.topic.threads.filter((t) => t.page === view.page);
  // 描き直す条件（旧 docSig）：ページ・版・差分の表示・このページのスレッドの（id・解決・版・位置づけ）。ポーリングの度には、描き直さない
  const sig = JSON.stringify([
    view.slug,
    view.page,
    view.version,
    showChanges,
    threads.map((t) => [t.id, t.resolved, t.version, t.anchor && (t.anchor.quote || t.anchor.blockHash)]),
  ]);

  // 描き直しの最新の入力（効果は、`sig` などが変わったときだけ走るが、読むのは、そのときの最新）
  const latest = useRef({ view, threads, showChanges, active });
  latest.current = { view, threads, showChanges, active };
  const renderTok = useRef(0); // 古い非同期の完了を、捨てる（旧 renderTok）
  const modelRef = useRef<DocModel | null>(null); // 描き終えた、いまの DocModel（描いている間は、前のもの）
  const docKey = useRef<string | null>(null); // 最後に描き始めた、ページ・版（view.key）
  const scrollTo = useRef(0); // 描き終えたあとに戻す、スクロール位置
  const settled = useRef(false); // 描き終えているか（描いている間は、入力中の強調を、描き終えたあとに、まとめて付ける）

  // biome-ignore lint/correctness/useExhaustiveDependencies: sig が、スレッド・版・差分の表示を表す。view・threads は、毎回作り直されるので、依存に入れない
  useEffect(() => {
    const art = ref.current;
    if (!art) return;
    const tok = ++renderTok.current;
    const scroller = art.closest<HTMLElement>('#docscroll');
    const cur = latest.current;
    // スクロール位置：同じページ・版の描き直し（ポーリング・返信・差分の切り替え）では、保つ。別のページ・版（view.key が変わる）へ移ったときは、引き継がず、先頭で開く。
    // 描いている途中の描き直しでは、描き終えた時点の位置を、保つ（本文が空になる間に、ブラウザが詰めた位置を、記録しない）
    if (docKey.current !== cur.view.key) scrollTo.current = 0;
    else if (settled.current) scrollTo.current = scroller?.scrollTop ?? 0;
    docKey.current = cur.view.key;
    settled.current = false;
    // 範囲を選んでいる途中の枠が、消える要素を指さないように
    if (useUi.getState().regMode === 'selecting') useUi.getState().setRegMode('idle');
    renderDoc(
      art,
      {
        view: cur.view,
        markdown,
        prevMarkdown,
        showChanges: cur.showChanges,
        threads: cur.threads,
        onComment: commentOn,
        onPick: pickOn,
        onFocus: openFocusApp,
        pendingAnchor: () => useUi.getState().composer?.anchor ?? null,
      },
      () => tok === renderTok.current,
    )
      .then((model) => {
        if (!model || tok !== renderTok.current) return;
        modelRef.current = model;
        settled.current = true;
        applyActive(art, useUi.getState().active);
        applyLinked(art, model, useUi.getState().linkedTid);
        // 比べる画面（F44）を閉じた直後：開く前の位置へ（範囲外は、ブラウザが収める）。枠・画像の高さが落ち着くまで、2 フレーム後にも、置き直す
        const restore = useUi.getState().takeScrollRestore();
        if (restore !== null) scrollTo.current = restore;
        if (scroller) scroller.scrollTop = scrollTo.current;
        if (restore !== null && scroller) {
          const applied = scroller.scrollTop; // 利用者が、そのあいだに動かしていれば（位置が変わっていれば）、置き直さない
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (tok === renderTok.current && Math.abs(scroller.scrollTop - applied) < 1) scroller.scrollTop = restore;
            }),
          );
        }
        useDoc.getState().setModel(model);
      })
      .catch(() => {
        if (tok === renderTok.current) toast('本文を表示できませんでした', true);
      });
  }, [sig, markdown, prevMarkdown]);

  // 入力中の対象（入力欄を開く・対象を選び直す・閉じる）を、本文で強調する。描いている間は、描き終えたときに付ける
  // biome-ignore lint/correctness/useExhaustiveDependencies: 入力欄の id が変わったときだけ（画像を付けるだけでは、本文に触らない）
  useEffect(() => {
    const art = ref.current;
    const model = modelRef.current;
    if (!art || !model || !settled.current) return;
    const pending = markPending(art, useUi.getState().composer?.anchor ?? null, model.pending);
    const next: DocModel = { ...model, epoch: nextEpoch(), pending };
    modelRef.current = next;
    useDoc.getState().setModel(next);
  }, [composerId]);

  // 選んでいるスレッド
  useEffect(() => {
    if (ref.current && settled.current) applyActive(ref.current, active);
  }, [active]);

  // 本文の強調・範囲の枠を押す：選ぶ（本文の強調を押したときは、1 枚だけ見る状態を解く）。コメントのない画像・図を押す：個別表示（F37・F43。委譲：このリスナー 1 つ）。Enter・Space：フォーカスした画像・図を、個別表示
  useEffect(() => {
    const art = ref.current;
    if (!art) return;
    const onClick = (e: MouseEvent): void => {
      if (e.target instanceof Element && e.target.closest('a[data-page]')) return; // ハッシュで遷移する
      const tid = articleTid(e, modelRef.current);
      if (!tid) {
        zoomOnClick(e, art); // コメントのない画像・図は、拡大（F37）。コメントの付いた対象を押すと、そのコメントを選ぶ（上）
        return;
      }
      const thread = latest.current.view.topic.threads.find((t) => t.id === tid);
      if (!thread) return;
      const ui = useUi.getState();
      if (ui.solo) ui.closeSolo();
      ui.focusThread(thread);
    };
    // キーボードの入口（F43）：フォーカスした画像・図（`markFocusEntries`）で、Enter・Space → 個別表示。コメントの有無に関係なく開く（コメントは、右のドックにある）
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const entry = e.target instanceof Element && e.target.hasAttribute(FOCUS_ENTRY) ? e.target : null;
      const el = entry ? mediaOfEntry(entry, art) : null;
      if (!el) return;
      e.preventDefault();
      openFocusOf(el);
    };
    art.addEventListener('mousedown', noteMouseDown); // 押した位置（押す・ドラッグの区別）
    art.addEventListener('click', onClick);
    art.addEventListener('keydown', onKey);
    return () => {
      art.removeEventListener('mousedown', noteMouseDown);
      art.removeEventListener('click', onClick);
      art.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    const art = ref.current; // 後始末の時には、ref は、もう null（要素を、ここで持つ）
    return () => {
      if (art) releaseApps(art); // 枠を橋から外す（メッセージの受け口も、枠が 0 になれば外れる）
      renderTok.current++;
      modelRef.current = null;
      useDoc.getState().setModel(null);
    };
  }, []);

  return <article id="article" className="md" ref={ref} />;
}
