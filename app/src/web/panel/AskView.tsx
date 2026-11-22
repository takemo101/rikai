// AI の質問（ask）と、その回答の入力。5 つの型（単一選択・複数選択・Yes/No・目盛り・自由記述）・下書き・保存・取り消し・送信済みの固定。
// F30：答えないまま会話が進んだ質問は、小さく見せる（質問の文と「答えずに、会話が進みました」・「答える」）。
// 回答の下書きは、ストア（`drafts.ask[質問のメッセージ ID]`）。キーがなければ、保存した回答から作る（描くとき、書き込まない）。
import { type ReactNode, useRef } from 'react';
import type { Ask, Message, Thread } from '../../shared/types';
import { useMutations } from '../api/mutations';
import { type AskDraft, useUi } from '../store/ui';
import { caretAtEnd } from './caret';
import { answerOf, askDraftValid, askStale, pickOption, typeOther } from './logic';

interface Props {
  slug: string;
  thread: Thread;
  /** 質問のメッセージ（`ask` を持つ） */
  q: Message & { ask: Ask };
}

/** 通信中の回答の操作：内容の鍵と、そのあとに送るもの（あれば） */
interface Flight {
  key: string;
  next: { payload: AskDraft | null } | null;
}

export function AskView({ slug, thread, q }: Props) {
  const ask = q.ask;
  const opened = useUi((s) => s.askOpen.has(q.id));
  const openAsk = useUi((s) => s.openAsk);
  const hasDraft = useUi((s) => q.id in s.drafts.ask);
  const stored = useUi((s) => s.drafts.ask[q.id]);
  const setDraft = useUi((s) => s.setAskDraft);
  const clearDraft = useUi((s) => s.clearAskDraft);
  const { answer } = useMutations();
  const flight = useRef<Flight | null>(null);

  if (askStale(thread, q) && !opened) {
    return (
      <div className="ask stale">
        <div className="ask-q">{ask.question}</div>
        <div className="ask-foot">
          <span className="chip small">答えずに、会話が進みました</span>
          <button type="button" className="link" onClick={() => openAsk(q.id)}>
            答える
          </button>
        </div>
      </div>
    );
  }

  const saved = answerOf(thread, q);
  const locked = !!saved?.sent || thread.resolved;
  // キーがなければ、保存した回答（なければ、なし）が、下書きの出発点
  const draft: AskDraft | null = hasDraft ? (stored ?? null) : (saved?.answer ?? null);
  const d: AskDraft = draft ?? {};
  const name = `ask-${q.id}`;

  // 回答の保存・取り消しは、順に送る：通信中に押されたものは、待たせて、終わってから送る（最後の押しが勝つ）。最後の押しが、通信中と同じ内容なら、待たせたものを捨てる（通信中のものが、最後の押し）
  const send = (payload: AskDraft | null): void => {
    const key = JSON.stringify(payload);
    if (flight.current !== null) {
      flight.current.next = key === flight.current.key ? null : { payload };
      return;
    }
    const run = (p: AskDraft | null): void => {
      const f: Flight = { key: JSON.stringify(p), next: null };
      flight.current = f;
      void answer({ topic: slug, thread: thread.id, msg: q.id, answer: p }).finally(() => {
        flight.current = null;
        if (f.next) run(f.next.payload);
      });
    };
    run(payload);
  };

  let input: ReactNode;
  if (ask.type === 'single_choice' || ask.type === 'multi_choice') {
    const multi = ask.type === 'multi_choice';
    input = (
      <>
        {ask.options.map((o) => {
          const checked = multi ? (d.choices ?? []).includes(o.id) : d.choice === o.id;
          return (
            <label className={`opt${checked ? ' on' : ''}`} key={o.id}>
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={name}
                checked={checked}
                disabled={locked}
                onChange={(e) => setDraft(q.id, pickOption(draft, multi, o.id, e.target.checked))}
              />
              <span>
                <span className="opt-l">{o.label}</span>
                {o.detail ? <span className="opt-d">{o.detail}</span> : null}
              </span>
            </label>
          );
        })}
        {ask.allowOther ? (
          <label className="opt other">
            その他
            <input
              type="text"
              ref={caretAtEnd}
              data-key={`ask-other-${q.id}`}
              value={d.other ?? ''}
              disabled={locked}
              placeholder="自由入力"
              onChange={(e) => setDraft(q.id, typeOther(draft, multi, e.target.value))}
            />
          </label>
        ) : null}
      </>
    );
  } else if (ask.type === 'yes_no') {
    input = (
      <div className="yn">
        {(
          [
            [true, 'はい'],
            [false, 'いいえ'],
          ] as const
        ).map(([val, label]) => (
          <button
            type="button"
            className={`pill${d.value === val ? ' on' : ''}`}
            disabled={locked}
            key={label}
            onClick={() => setDraft(q.id, { ...d, value: val })}
          >
            {label}
          </button>
        ))}
      </div>
    );
  } else if (ask.type === 'scale') {
    const steps: number[] = [];
    for (let i = ask.min; i <= ask.max; i++) steps.push(i);
    input = (
      <div className="scale">
        {ask.minLabel ? <span className="sl">{ask.minLabel}</span> : null}
        {steps.map((i) => (
          <button
            type="button"
            className={`pill${d.value === i ? ' on' : ''}`}
            disabled={locked}
            key={i}
            onClick={() => setDraft(q.id, { ...d, value: i })}
          >
            {i}
          </button>
        ))}
        {ask.maxLabel ? <span className="sl">{ask.maxLabel}</span> : null}
      </div>
    );
  } else {
    input = (
      <textarea
        rows={3}
        ref={caretAtEnd}
        data-key={`ask-text-${q.id}`}
        value={d.text ?? ''}
        disabled={locked}
        placeholder={ask.placeholder || '自分の言葉で'}
        onChange={(e) => setDraft(q.id, { ...d, text: e.target.value })}
      />
    );
  }

  let foot: ReactNode = null;
  if (locked) {
    if (saved) foot = <span className="chip ok">{saved.sent ? '回答を送信済み' : '回答済み'}</span>;
  } else {
    const valid = askDraftValid(ask, draft);
    const same = !!saved && JSON.stringify(saved.answer) === JSON.stringify(draft);
    foot = (
      <>
        <button type="button" className="primary small" disabled={!valid || same} onClick={() => send(draft)}>
          {same ? '保存済み（未送信）' : '回答を保存'}
        </button>
        {saved ? (
          <button
            type="button"
            className="ghost small"
            onClick={() => {
              clearDraft(q.id); // 取り消すと、下書きも、保存した回答から作り直す（失敗したときも、保存した回答のまま）
              send(null);
            }}
          >
            取り消す
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="ask">
      <div className="ask-q">{ask.question}</div>
      {input}
      <div className="ask-foot">{foot}</div>
    </div>
  );
}
