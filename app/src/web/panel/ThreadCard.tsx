// スレッドのカード（`.thread`）：札・対象の引用・発言（古いやり取りは折りたたむ：F29）・返信の入力・「解決」／「再開する」。
import {
  Check,
  ChevronRight,
  CircleCheck,
  CircleDot,
  Clock,
  Hourglass,
  MessageCircleQuestion,
  Plus,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { isLegacyFromFrame } from '../../shared/htmlapp-bridge';
import type { Thread } from '../../shared/types';
import { useMutations } from '../api/mutations';
import type { View } from '../lib/view';
import type { DocModel } from '../store/doc';
import { useUi } from '../store/ui';
import { caretAtEnd } from './caret';
import { FromFrame } from './FrameMetaChip';
import { AttachButton, ImageBar } from './ImageBar';
import { foldMessages, quoteOf, threadStatus } from './logic';
import { MessageView } from './Message';
import { usePanel } from './panelContext';
import { Quote } from './Quote';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  view: View;
  thread: Thread;
  /** 番号を押して、そのカードだけを見るとき：古いやり取りも、たたまない */
  full?: boolean;
  /** 本文の位置・番号・近似（見つかっているとき。別のページの古いものは、渡さない） */
  model: DocModel | null;
  /**
   * 折りたたみと、発言の「新着」の印（●）に使う、見たものの一覧。**パネルを描き直したときの値**：
   * カードを押して、見たことになっても、いま読んでいる発言が、すぐには、たたまれない。次に、パネルが描き直されるとき（切り替え・1 枚だけ見る・データの更新）に、反映される
   */
  seen: ReadonlySet<string>;
  /** 編集中のメッセージ ID（編集中の発言は、たたまない） */
  editing: string | null;
}

/** 札のアイコン（`threadStatus` のクラスごと） */
const STATUS_ICON = {
  ok: CircleCheck,
  draft: CircleDot,
  new: Sparkles,
  wait: Clock,
  yours: MessageCircleQuestion,
  aiwait: Hourglass,
} as const;

export function ThreadCard({ view, thread: t, full = false, model, seen, editing }: Props) {
  const { focusThread } = usePanel();
  const active = useUi((s) => s.active === t.id);
  const linked = useUi((s) => s.linkedTid === t.id);
  // カードの縁の印は、見たらすぐ消える（折りたたみは、上の `seen`）
  const fresh = useUi((s) => t.messages.some((m) => m.author === 'ai' && !s.seen.has(m.id)));

  const [stText, stCls] = threadStatus(t, view.topic.meta.pending);
  const StatusIcon = STATUS_ICON[stCls];
  const loc = model?.locs.get(t.id);
  // 位置が「見つからない」と分かっているものだけ（まだ、本文を描いていないものは、印を出さない）
  const orphan = loc?.kind === 'none' && !!t.anchor && t.version <= view.version;
  const future = t.version > view.version;
  const num = model?.nums.get(t.id);
  const approx = model?.approx.get(t.id);

  const cls = ['thread', stCls, active && 'active', fresh && 'fresh', linked && 'linked'].filter(Boolean).join(' ');
  const segments = foldMessages(t, { full, seen, editing });
  // 「枠から」の札：**`frameMeta` の有無で決める**（本文の見出しの行には、頼らない：資料の本文の `<div>枠から：p</div>` や、利用者が本文に「【枠から】」と書いたコメントに、付かない）。
  // `frameMeta` を持たない旧い形のコメント（0.25.x まで：本文に見出しと JSON）だけ、錨の形＋最初の発言の見出しの行で判定する
  const first = t.messages[0];
  const fromFrame =
    t.messages.some((m) => m.author === 'user' && m.frameMeta) ||
    (!!t.anchor && isLegacyFromFrame(t.anchor, first?.author === 'user' ? (first.text ?? '') : ''));

  return (
    <div className={cls} data-tid={t.id} {...(fromFrame ? { 'data-from-frame': '' } : {})}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: 既存の DOM（見出しの押下は、マウスの近道。キーボードは、カード内のボタン） */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 同上 */}
      <div className="th-head" onClick={() => focusThread(t.id, true)}>
        {num !== undefined ? (
          <span className={`no${t.resolved ? ' resolved' : ''}`} title="本文の、同じ番号の印の所へのコメントです">
            {String(num)}
          </span>
        ) : null}
        {stCls === 'wait' ? null : (
          <span className={`chip ${stCls} small`}>
            <StatusIcon aria-hidden="true" focusable="false" />
            {stText}
          </span>
        )}
        {t.version === view.version ? null : <span className="chip small">v{t.version}</span>}
        {orphan ? (
          <span className="chip warn small">
            <TriangleAlert aria-hidden="true" focusable="false" />
            修正で文が変わりました
          </span>
        ) : null}
        {approx ? (
          <span className="chip warn small">
            <TriangleAlert aria-hidden="true" focusable="false" />
            {approx === 'similar' ? '近い内容のブロックに表示' : '同じ位置のブロックに表示'}
          </span>
        ) : null}
        {future ? <span className="chip small">後の版のコメント</span> : null}
        {fromFrame ? <FromFrame /> : null}
        <Quote anchor={t.anchor} text={quoteOf(t)} />
      </div>
      {segments.map((s) =>
        s.kind === 'msg' ? (
          <MessageView key={s.m.id} view={view} thread={t} m={s.m} seen={seen} />
        ) : (
          <Older key={s.key} id={s.key} count={s.items.length}>
            {s.items.map((m) => (
              <MessageView key={m.id} view={view} thread={t} m={m} seen={seen} />
            ))}
          </Older>
        ),
      )}
      <ThreadFoot view={view} thread={t} />
    </div>
  );
}

/** 「これまでのやり取り（N 件）」。開いた状態は、ストア（`olderOpen`）：描き直しても、画面の更新を挟んでも、開いたまま */
function Older({ id, count, children }: { id: string; count: number; children: ReactNode }) {
  const open = useUi((s) => s.olderOpen.has(id));
  const setOlderOpen = useUi((s) => s.setOlderOpen);
  return (
    <details className="older" open={open} onToggle={(e) => setOlderOpen(id, e.currentTarget.open)}>
      <summary>
        <ChevronRight aria-hidden="true" focusable="false" />
        {`これまでのやり取り（${count} 件）`}
      </summary>
      {children}
    </details>
  );
}

/** 返信の入力と、解決・再開 */
function ThreadFoot({ view, thread: t }: { view: View; thread: Thread }) {
  const slug = view.slug;
  const key = `reply-${t.id}`;
  const draft = useUi((s) => s.drafts.reply[t.id] ?? '');
  const setReplyDraft = useUi((s) => s.setReplyDraft);
  const setRowOpen = useUi((s) => s.setRowOpen);
  const resetImgs = useUi((s) => s.resetImgs);
  const { reply, resolve } = useMutations();
  const imgs = useDraftImgs(key);
  const { handlers } = useImageAttach(key, slug);
  const busy = useRef(false);

  const sendReply = async (): Promise<void> => {
    if (busy.current) return;
    const text = draft.trim();
    const state = useUi.getState();
    if (state.uploading) {
      state.showToast('画像のアップロード中です。終わってから、追加してください', true);
      return;
    }
    if (!text && !imgs.length) return;
    busy.current = true; // 送っている間の、2 回押し（同じ返信が 2 件になる）を防ぐ
    try {
      await reply(
        { topic: slug, thread: t.id, text, images: [...imgs] },
        {
          onOk: () => {
            setReplyDraft(t.id, '');
            resetImgs(key);
          },
        },
      );
    } finally {
      busy.current = false;
    }
  };

  if (t.resolved) {
    return (
      <div className="th-foot">
        <button
          type="button"
          className="ghost small"
          onClick={() =>
            void resolve({ topic: slug, thread: t.id, resolved: false }, { onOk: () => setRowOpen(t.id, false) })
          }
        >
          <RotateCcw aria-hidden="true" focusable="false" />
          再開する
        </button>
      </div>
    );
  }
  return (
    <div className="th-foot">
      <textarea
        rows={2}
        ref={caretAtEnd}
        data-key={key}
        placeholder="返信・追加の質問（⌘/Ctrl+Enter で追加。画像は、貼り付け・ドラッグでも）"
        value={draft}
        onChange={(e) => setReplyDraft(t.id, e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            void sendReply();
          }
        }}
        {...handlers}
      />
      <ImageBar imgKey={key} slug={slug} />
      <div className="row">
        <AttachButton imgKey={key} slug={slug} />
        <button
          type="button"
          className="primary small"
          title="返信を、下書きに追加します（⌘/Ctrl＋Enter）。まだ AI には送られません（「AI に送る」で送ります）"
          onClick={() => void sendReply()}
        >
          <Plus aria-hidden="true" focusable="false" />
          追加
        </button>
        <button
          type="button"
          className="ghost small"
          title="理解できたら、解決にします"
          onClick={() =>
            void resolve({ topic: slug, thread: t.id, resolved: true }, { onOk: () => setRowOpen(t.id, false) })
          }
        >
          <Check aria-hidden="true" focusable="false" />
          解決
        </button>
      </div>
    </div>
  );
}
