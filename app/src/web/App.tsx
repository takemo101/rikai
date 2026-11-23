// 画面の全体（旧 index.html の静的なシェルと、app.js のルーティング・更新）。W1〜W3 の部品を、旧 DOM の場所に置く（contracts.ts）。
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { usePage, useTopic, useTopics } from './api/queries';
import type { ArticleProps } from './contracts';
import { Article } from './doc/Article';
import { fillMermaid } from './doc/render';
import { Interact } from './interact/Interact';
import { DocBar } from './layout/DocBar';
import { EndDialog } from './layout/EndDialog';
import { EndedScreen } from './layout/EndedScreen';
import { usePanelGeometry } from './layout/geometry';
import { NOTICE, Notice } from './layout/Notice';
import { Resizer } from './layout/Resizer';
import { SideNav } from './layout/SideNav';
import { SubmitDialog } from './layout/SubmitDialog';
import { serverStatus } from './layout/status';
import { Toast } from './layout/Toast';
import { TopBar } from './layout/TopBar';
import { navigate, type Route, useRoute } from './lib/route';
import { useResolvedTheme } from './lib/theme';
import { buildView, type View } from './lib/view';
import { Connectors } from './overlay/Connectors';
import { Overlays } from './overlay/Overlays';
import { ThreadsPanel } from './panel/ThreadsPanel';
import { useDoc } from './store/doc';
import { toast, useUi } from './store/ui';

export function App() {
  const route = useRoute();
  const topicsQ = useTopics();
  const topics = topicsQ.data;
  const target = route ? topics?.find((t) => t.slug === route.slug) : undefined;
  const unsupported = target?.unsupported === true;
  // 一覧が届くまでは、トピックを取らない（読めない形式のトピックを、取りにいかない：サーバーが 409 を返し続ける）
  const topicQ = useTopic(topics && route && !unsupported ? route.slug : null);
  const view = buildView(route, topicQ.data);
  const status = serverStatus([topicsQ.error, topicQ.error]);

  const pageQ = usePage(view?.slug ?? null, view?.page ?? 'root', view?.version ?? 0);
  const prevQ = usePage(view?.slug ?? null, view?.page ?? 'root', (view?.version ?? 0) - 1);
  const ready = !!view && pageQ.data !== undefined && (view.version === 1 || prevQ.data !== undefined);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sideOpen = useUi((s) => s.ui.sideOpen);
  const { w } = usePanelGeometry();

  useNavigationEffects(route, view, scrollRef);
  useRedrawDiagrams();
  useUpdateToast(view, route?.version ?? null);

  // ページの読み込みの失敗（版が範囲外・サーバーのエラー）は、トーストで知らせる
  // 同じ内容の失敗が、取り直しのたびに、続けて出ないよう、メッセージが変わったときだけ
  const pageErrorMsg = (pageQ.error ?? prevQ.error)?.message;
  useEffect(() => {
    if (pageErrorMsg) toast(pageErrorMsg, true);
  }, [pageErrorMsg]);

  // 本文の取得は、失敗したら、そのままになる（版の本文は変わらないので、`staleTime: Infinity`）。トピックの更新が来る度（1.5 秒ごと）に、取り直す（旧は、次の更新で、戻った）
  const { refetch: refetchPage, isError: pageFailed } = pageQ;
  const { refetch: refetchPrev, isError: prevFailed } = prevQ;
  const topicUpdatedAt = topicQ.dataUpdatedAt;
  // biome-ignore lint/correctness/useExhaustiveDependencies: トピックの更新（dataUpdatedAt）が契機。失敗の印は、そのときの値を読む
  useEffect(() => {
    if (pageFailed) void refetchPage();
    if (prevFailed) void refetchPrev();
  }, [topicUpdatedAt]);

  // ルートがないとき：最初の読めるトピックへ移る
  const firstSupported = topics?.find((t) => !t.unsupported);
  useEffect(() => {
    if (!route && firstSupported) navigate(firstSupported.slug);
  }, [route, firstSupported]);

  // 本文の場所：案内（トピックなし・読めない形式）・本文・読み込み中（新しい本文が届くまでは、前の本文を、そのまま見せる）
  let notice: string | null = null;
  if (!topics) notice = '';
  else if (!route) notice = firstSupported ? '' : topics.length ? NOTICE.onlyUnsupported : NOTICE.noTopics;
  else if (target?.unsupported) notice = NOTICE.unsupported(target.title);

  const held = useRef<ArticleProps | null>(null);
  if (notice !== null) held.current = null;
  else if (ready)
    held.current = { view, markdown: pageQ.data ?? '', prevMarkdown: view.version > 1 ? (prevQ.data ?? null) : null };

  // 本文がないあいだ（案内）、DocModel を残さない
  useEffect(() => {
    if (notice !== null) useDoc.getState().setModel(null);
  }, [notice]);

  // 本文の中のページへのリンクを押したら、入力欄の対象は、閉じる（旧と同じ）
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.target instanceof Element && e.target.closest('a.pagecard, a.pagelink'))
        useUi.getState().dropComposerTarget();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  let body: ReactNode;
  if (notice !== null) body = <Notice text={notice} />;
  else if (held.current) body = <Article {...held.current} />;
  else body = <Notice text="" />;

  return (
    <>
      <div
        id="app"
        className={sideOpen ? undefined : 'side-collapsed'}
        style={{ '--panel-w': `${w}px` } as CSSProperties}
      >
        <TopBar view={view} status={status} />
        <SideNav topics={topics ?? []} currentSlug={target && !unsupported ? target.slug : null} view={view} />
        <main id="doc">
          <DocBar view={view} />
          <div id="docscroll" ref={scrollRef}>
            {body}
            <Overlays view={view} scrollRef={scrollRef} />
          </div>
          {/* 見せている本文が、いまのページ・版のものでない間（取得中・取得に失敗）は、コメントの入口を出さない：食い違う本文に、コメントを付けないため */}
          <Interact view={held.current?.view.key === view?.key ? view : null} scrollRef={scrollRef} />
        </main>
        <ThreadsPanel view={view} />
        <Resizer />
      </div>
      <Connectors view={view} scrollRef={scrollRef} />
      <Toast />
      <SubmitDialog slug={view?.slug ?? null} unsent={view?.topic.unsent ?? 0} />
      <EndDialog slug={view?.slug ?? null} />
      <EndedScreen view={view} topics={topics ?? []} />
    </>
  );
}

/**
 * ルートが変わったときの、画面の状態の整理（旧 route()）：
 *  - 見ている場所（slug・ページ・明示の版）が変わったら、選んでいるスレッドを外し、本文の先頭へ戻す
 *  - 別のトピックへ移ったら、添付した画像（そのトピックの assets/）を持ち越さず、入力欄を閉じる
 *  - 実質、見ている版が変わったら（`/v2` を明示して、最新版へ、などは、変わらない）、入力欄を閉じる。入力中の対象（本文の位置）が、意味を失うため
 */
function useNavigationEffects(
  route: Route | null,
  view: View | null,
  scrollRef: RefObject<HTMLDivElement | null>,
): void {
  const slug = route?.slug;
  const page = route?.page;
  const version = route?.version;
  const prev = useRef<{ slug?: string; page?: string; version?: number | null } | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = { slug, page, version };
    if (!p) return;
    if (p.slug !== slug) {
      useUi.getState().leaveTopic();
      useUi.getState().closeComposer();
    }
    if (p.slug !== slug || p.page !== page || p.version !== version) {
      useUi.getState().setActive(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [slug, page, version, scrollRef]);

  const key = view?.key ?? null;
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    if (prevKey.current !== null && prevKey.current !== key && useUi.getState().composer)
      useUi.getState().closeComposer();
    prevKey.current = key;
  }, [key]);
}

/** 最新版を見ているとき、資料が更新されたら、知らせる（ページが同じで、最新版の番号が増えたとき） */
function useUpdateToast(view: View | null, explicitVersion: number | null): void {
  const last = useRef<{ page: string; latest: number } | null>(null);
  const slug = view?.slug;
  const page = view?.page;
  const latest = view?.latest;
  useEffect(() => {
    if (slug === undefined || page === undefined || latest === undefined) {
      last.current = null;
      return;
    }
    const id = `${slug}/${page}`;
    const p = last.current;
    if (p && p.page === id && !explicitVersion && latest > p.latest) toast(`資料が v${latest} に更新されました`);
    last.current = { page: id, latest };
  }, [slug, page, latest, explicitVersion]);
}

/** 外観が変わったら（ボタン・OS の外観の変化）、描いてある Mermaid の図を、その外観で描き直す（本文・AI の返信の、どちらも）。最初の描画は、各部品が、その外観で描く */
function useRedrawDiagrams(): void {
  const theme = useResolvedTheme();
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: theme が変わったときだけ（最初は、描かない）
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void fillMermaid(document);
  }, [theme]);
}
