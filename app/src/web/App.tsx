// 画面の全体（シェル・ルーティング・更新）。本文・番号の層・右のパネル・入口の部品を、決まった DOM の場所に置く（contracts.ts）。
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useServerEvents } from './api/events';
import { usePage, useTopic, useTopics } from './api/queries';
import { CompareView } from './compare/CompareView';
import type { ArticleProps } from './contracts';
import { Article } from './doc/Article';
import { fillDiagrams } from './doc/render';
import { followPageTheme } from './htmlapp/frameRegistry';
import { Interact } from './interact/Interact';
import { DocBar } from './layout/DocBar';
import { EndDialog } from './layout/EndDialog';
import { EndedScreen } from './layout/EndedScreen';
import { PANEL_DEFAULT_NARROW, usePanelGeometry } from './layout/geometry';
import { NOTICE, Notice } from './layout/Notice';
import { Resizer } from './layout/Resizer';
import { SideNav } from './layout/SideNav';
import { SubmitDialog } from './layout/SubmitDialog';
import { serverStatus } from './layout/status';
import { Toast } from './layout/Toast';
import { TopBar } from './layout/TopBar';
import { useTurn } from './layout/TurnPill';
import { useBrowserNotify } from './layout/useBrowserNotify';
import { navigate, type Route, useRoute } from './lib/route';
import { useResolvedTheme } from './lib/theme';
import { docTitle } from './lib/turn';
import { buildView, type View } from './lib/view';
import { Connectors } from './overlay/Connectors';
import { Overlays } from './overlay/Overlays';
import { ThreadsPanel } from './panel/ThreadsPanel';
import { useDoc } from './store/doc';
import { toast, useUi } from './store/ui';

export function App() {
  useServerEvents();
  const route = useRoute();
  const topicsQ = useTopics();
  const topics = topicsQ.data;
  const target = route ? topics?.find((t) => t.slug === route.slug) : undefined;
  const unsupported = target?.unsupported === true;
  // 一覧が届くまでは、トピックを取らない（読めない形式のトピックを、取りにいかない：サーバーが 409 を返し続ける）
  const topicQ = useTopic(topics && route && !unsupported ? route.slug : null);
  const view = buildView(route, topicQ.data);
  const status = serverStatus([topicsQ.error, topicQ.error]);
  const compare = useUi((s) => s.compare);

  const pageQ = usePage(view?.slug ?? null, view?.page ?? 'root', view?.version ?? 0);
  const prevQ = usePage(view?.slug ?? null, view?.page ?? 'root', (view?.version ?? 0) - 1);
  const ready = !!view && pageQ.data !== undefined && (view.version === 1 || prevQ.data !== undefined);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { w, sideShown, drawer, autoHidden, narrow } = usePanelGeometry();
  useLayoutReset({ drawer, autoHidden, narrow });
  useFollowAppFrames();

  useNavigationEffects(route, view, scrollRef);
  useRedrawDiagrams();
  useDocumentTitle(view);
  useBrowserNotify();
  useUpdateToast(view, route?.version ?? null);

  // ページの読み込みの失敗（版が範囲外・サーバーのエラー）は、トーストで知らせる
  // 同じ内容の失敗が、取り直しのたびに、続けて出ないよう、メッセージが変わったときだけ
  const pageErrorMsg = (pageQ.error ?? prevQ.error)?.message;
  useEffect(() => {
    if (pageErrorMsg) toast(pageErrorMsg, true);
  }, [pageErrorMsg]);

  // 本文の取得は、失敗したら、そのままになる（版の本文は変わらないので、`staleTime: Infinity`）。トピックの更新が来る度（1.5 秒ごと）に、取り直す
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

  // 本文の中のページへのリンクを押したら、入力欄の対象は、閉じる
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.target instanceof Element && e.target.closest('a.pagecard, a.pagelink'))
        useUi.getState().dropComposerTarget();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // 版を並べて比べているとき（F44）：本文の代わりに、比べる画面。通常の本文（`Article`）は、外す（枠は、閉じるときに、橋から外れる）。コメントの入口・番号の層・右のコメントは、出さない（読み取り専用）
  const comparing = notice === null && !!compare && !!view;
  let body: ReactNode;
  if (notice !== null) body = <Notice text={notice} />;
  else if (compare && view) body = <CompareView view={view} compare={compare} />;
  else if (held.current) body = <Article {...held.current} />;
  else body = <Notice text="" />;

  return (
    <>
      <div
        id="app"
        className={
          [
            sideShown ? '' : 'side-collapsed',
            drawer ? 'side-drawer' : '',
            w <= PANEL_DEFAULT_NARROW ? 'panel-tight' : '', // 280px 以下（細い既定 280 を含む）：余白・切り替え・入力欄を、詰める
            comparing ? 'comparing' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        style={{ '--panel-w': `${w}px` } as CSSProperties}
      >
        <TopBar view={view} status={status} save={{ markdown: pageQ.data, failed: pageQ.isError }} />
        <SideNav topics={topics ?? []} currentSlug={target && !unsupported ? target.slug : null} view={view} />
        <main id="doc">
          <DocBar view={view} />
          <div id="docscroll" ref={scrollRef}>
            {body}
            <Overlays view={comparing ? null : view} scrollRef={scrollRef} />
          </div>
          {/* 見せている本文が、いまのページ・版のものでない間（取得中・取得に失敗）は、コメントの入口を出さない：食い違う本文に、コメントを付けないため */}
          <Interact view={!comparing && held.current?.view.key === view?.key ? view : null} scrollRef={scrollRef} />
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
 * ルートが変わったときの、画面の状態の整理：
 *  - 見ている場所（slug・ページ・明示の版）が変わったら、選んでいるスレッドを外し、本文の先頭へ戻す
 *  - 別のトピック・ページへ移ったら、書きかけのコメントを「対象を失った下書き」へ移す（黙って消さない）。別のトピックへは、添付した画像（そのトピックの assets/）を持ち越さない
 *  - 実質、見ている版が変わったら（`/v2` を明示して、最新版へ、などは、変わらない）、書きかけを、黙って閉じない：最新版なら、対象を探し直して続ける・そうでなければ「対象を失った下書き」へ
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
    // 比べる画面は、ページ・トピックを移ると閉じる（同じページの版の切り替え〔ハッシュの版〕では、閉じない）
    if (p.slug !== slug || p.page !== page) {
      useUi.setState({ lightboxBack: null }); // 重ねて開いた添付を閉じても、前のページの拡大表示（ドックつき）へ戻らない（ドックつきの拡大表示は、ページを移ると閉じる）
      useUi.getState().closeCompare(false);
    }
    // 別のトピック・ページへ移る：書きかけのコメントは、黙って消さず、「対象を失った下書き」へ（別の対象に付けない。F44 と同じ）。
    // 添付の画像は、そのトピックの assets/ にあるので、トピックを移るときは、持ち越さない（`leaveTopic`。先に、下書きへ移してから）
    const ui = useUi.getState();
    if (ui.composer && p.slug !== slug) ui.loseComposerDraft('別のトピックにあります');
    else if (ui.composer && p.page !== page) ui.loseComposerDraft('別のページにあります');
    if (p.slug !== slug) ui.leaveTopic();
    if (p.slug !== slug || p.page !== page || p.version !== version) {
      useUi.getState().setActive(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [slug, page, version, scrollRef]);

  // 同じページで、見ている版が変わった（版の切り替え・新しい版が届いた）：書きかけの入力欄を、黙って閉じない（`moveComposer`）。入力中の対象（本文の位置）は、版で意味が変わる
  const key = view?.key ?? null;
  const isLatest = view?.isLatest ?? false;
  const prevView = useRef<{ key: string; slug: string; page: string } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 見ている版（key）が変わったときだけ。view は、毎回作り直される
  useEffect(() => {
    const v = viewRef.current;
    if (key === null || !v) return;
    const p = prevView.current;
    prevView.current = { key, slug: v.slug, page: v.page };
    if (p && p.key !== key && p.slug === v.slug && p.page === v.page) useUi.getState().moveComposer(isLatest);
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

/**
 * 窓の大きさに合わせて、一時の状態を片づける：自動で隠す窓（1100px 以下）を出たら、重ねて出した左の一覧（ドロワー）をしまう・狭い窓（〜900px）を出たら、取っ手で変えた幅を捨てる
 * （どちらも保存しない値。あとで、狭い窓に戻ったとき、勝手に出てこない・古い幅にならない）。ドロワーを出している間は、外を押す・Esc・一覧の中のリンクで、しまう
 */
function useLayoutReset({
  drawer,
  autoHidden,
  narrow,
}: {
  drawer: boolean;
  autoHidden: boolean;
  narrow: boolean;
}): void {
  const staleDrawer = useUi((s) => s.narrowSideOpen) && !autoHidden;
  useEffect(() => {
    if (staleDrawer) useUi.getState().closeSideDrawer();
  }, [staleDrawer]);
  const staleWidth = useUi((s) => s.panelWNarrow !== null) && !narrow;
  useEffect(() => {
    if (staleWidth) useUi.getState().setPanelWNarrow(null);
  }, [staleWidth]);
  useEffect(() => {
    if (!drawer) return;
    const close = () => useUi.getState().closeSideDrawer();
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest('#side, #btn-side')) close();
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest('#side a')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [drawer]);
}

/** タブのタイトル（F39）：いま、誰の番か・資料の題。別のタブを見ていても、気づける。文字のまま入れる（HTML として解釈されない） */
function useDocumentTitle(view: View | null): void {
  const turn = useTurn(view);
  const title = view?.topic.meta.title;
  useEffect(() => {
    document.title = docTitle(turn, title);
  }, [turn, title]);
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
    void fillDiagrams(document);
  }, [theme]);
}

/** 外観が変わったら、実行できる枠（html-app）も、その外観にする（`theme` を送るだけ：再読み込みしない。枠の中の状態は、保たれる。枠だけの外観は、解く） */
function useFollowAppFrames(): void {
  const theme = useResolvedTheme();
  useEffect(() => {
    followPageTheme(theme);
    useUi.getState().setCompareMode(null); // 比較用ツールバーの枠だけの外観も、解く（枠は、`followPageTheme` が、画面に合わせる）
  }, [theme]);
}
