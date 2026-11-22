// 本文（`<article id="article" class="md">`）。**命令的な島**：子を持たない要素で出し、中身は、`render/renderDoc.ts` が DOM を作って `replaceChildren` する。React は、中身を触らない。
// 描き終えたら、DocModel（どのブロック・強調・番号が、どこにあるか）を、`useDoc` へ入れる（パネル・番号の層・入口のバーが読む）。
import { useEffect, useRef } from 'react';
import type { ArticleProps } from '../contracts';
import { $$ } from '../lib/dom';
import { type BlockEl, type DocModel, locEl, nextEpoch, useDoc } from '../store/doc';
import { toast, useUi } from '../store/ui';
import { articleTid } from './hit';
import { blockAnchor } from './render/blocks';
import { markPending } from './render/highlights';
import { renderDoc } from './render/renderDoc';

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

/** 「この枠にコメント」：枠を対象に、入力欄を開く（開けたら、入力欄へフォーカスを移し、選択を外す） */
function commentOn(box: BlockEl): void {
  if (!useUi.getState().startComposer(blockAnchor(box))) return;
  getSelection()?.removeAllRanges();
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('[data-key="composer"]')?.focus();
    document.querySelector('.thread.composer')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
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
        if (scroller) scroller.scrollTop = scrollTo.current;
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

  // 本文の強調・範囲の枠を押す：選ぶ（本文の強調を押したときは、1 枚だけ見る状態を解く）
  useEffect(() => {
    const art = ref.current;
    if (!art) return;
    const onClick = (e: MouseEvent): void => {
      if (e.target instanceof Element && e.target.closest('a[data-page]')) return; // ハッシュで遷移する
      const tid = articleTid(e, modelRef.current);
      if (!tid) return;
      const thread = latest.current.view.topic.threads.find((t) => t.id === tid);
      if (!thread) return;
      const ui = useUi.getState();
      if (ui.solo) ui.closeSolo();
      ui.focusThread(thread);
    };
    art.addEventListener('click', onClick);
    return () => art.removeEventListener('click', onClick);
  }, []);

  useEffect(
    () => () => {
      renderTok.current++;
      modelRef.current = null;
      useDoc.getState().setModel(null);
    },
    [],
  );

  return <article id="article" className="md" ref={ref} />;
}
