// スレッドの 1 件の発言。ユーザー：文字として出す（`textContent` と同じ。編集・削除は、未送信だけ）。AI：Markdown（無害化したもの）・資料の更新・ページへのカード・質問。
// 回答（kind が answer）は、質問の下の入力欄（AskView）で見せるので、描かない。
import { ArrowRight, Check, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import type { Ask, Message, Thread } from '../../shared/types';
import { useMutations } from '../api/mutations';
import { fillMermaid, mdToFragment } from '../doc/render';
import type { View } from '../lib/view';
import { useUi } from '../store/ui';
import { AskView } from './AskView';
import { caretAtEnd } from './caret';
import { FrameMetaChip } from './FrameMetaChip';
import { imgUrl } from './logic';

interface Props {
  view: View;
  thread: Thread;
  m: Message;
  /** 「まだ見ていない」の判定に使う、見たものの一覧（折りたたみと、同じ時点のもの） */
  seen: ReadonlySet<string>;
}

/** AI の返信の本体：Markdown → 無害化（PURIFY）した DOM。React は、中身を触らない（命令的な島）。Mermaid は、描き終わると、図に差し替わる */
function ReplyBody({ text, slug }: { text: string | undefined; slug: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.replaceChildren(mdToFragment(text, { slug, kind: 'reply' }));
    void fillMermaid(el);
  }, [text, slug]);
  return <div className="body md" ref={ref} />;
}

function UserMessage({ view, thread, m }: Omit<Props, 'seen'>) {
  const editing = useUi((s) => s.editing === m.id);
  const draft = useUi((s) => s.drafts.edit[m.id]);
  const setEditing = useUi((s) => s.setEditing);
  const setEditDraft = useUi((s) => s.setEditDraft);
  const clearEditDraft = useUi((s) => s.clearEditDraft);
  const { edit, delete: remove } = useMutations();
  const slug = view.slug;

  if (editing) {
    const done = (): void => {
      setEditing(null);
      clearEditDraft(m.id);
    };
    return (
      <div className="msg user">
        <textarea
          rows={3}
          ref={caretAtEnd}
          data-key={`edit-${m.id}`}
          value={draft ?? m.text ?? ''}
          onChange={(e) => setEditDraft(m.id, e.target.value)}
        />
        <div className="row">
          <button
            type="button"
            className="primary small"
            onClick={() =>
              void edit({ topic: slug, thread: thread.id, msg: m.id, text: draft ?? m.text }, { onOk: done })
            }
          >
            <Check aria-hidden="true" focusable="false" />
            保存
          </button>
          <button type="button" className="ghost small" onClick={done}>
            キャンセル
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="msg user">
      {m.frameMeta ? <FrameMetaChip meta={m.frameMeta} showTag={false} /> : null}
      {m.text ? <div className="body pre">{m.text}</div> : null}
      {m.images?.length ? (
        <div className="imgs">
          {m.images.map((n) => (
            <a href={imgUrl(slug, n)} target="_blank" rel="noopener" key={n}>
              <img src={imgUrl(slug, n)} alt="添付の画像" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
      {m.sent ? null : (
        <div className="row meta">
          <button type="button" className="iconbtn" title="編集" aria-label="編集" onClick={() => setEditing(m.id)}>
            <Pencil aria-hidden="true" focusable="false" />
          </button>
          <button
            type="button"
            className="iconbtn"
            title="削除"
            aria-label="削除"
            onClick={() => void remove({ topic: slug, thread: thread.id, msg: m.id })}
          >
            <Trash2 aria-hidden="true" focusable="false" />
          </button>
        </div>
      )}
    </div>
  );
}

/** 質問つきの発言（元のメッセージのまま渡す：`askStale` は、スレッドの中の位置で決める） */
const hasAsk = (m: Message): m is Message & { ask: Ask } => !!m.ask;

export function MessageView({ view, thread, m, seen }: Props) {
  if (m.kind === 'answer') return null;
  if (m.author === 'user') return <UserMessage view={view} thread={thread} m={m} />;

  const isNew = !seen.has(m.id);
  const page = m.page ? view.pages[m.page] : undefined;
  return (
    <div className={`msg ai${isNew ? ' fresh' : ''}`}>
      <div className="who">AI</div>
      <ReplyBody text={m.text} slug={view.slug} />
      {m.revision ? (
        <div className="row meta">
          <span className="chip ok small">
            <RefreshCw aria-hidden="true" focusable="false" />
            資料を v{m.revision} に更新
          </span>
          <a className="btnlink" href={`#/${view.slug}/${thread.page}/v${m.revision}`}>
            v{m.revision} を見る
            <ArrowRight aria-hidden="true" focusable="false" />
          </a>
        </div>
      ) : null}
      {m.page && page ? (
        <a className="pagecard" href={`#/${view.slug}/${m.page}`}>
          <span className="pc-l">詳しく見る</span>
          <span className="pc-t">{page.title}</span>
          <ArrowRight className="pc-a" aria-hidden="true" focusable="false" />
        </a>
      ) : null}
      {hasAsk(m) ? <AskView slug={view.slug} thread={thread} q={m} /> : null}
    </div>
  );
}
