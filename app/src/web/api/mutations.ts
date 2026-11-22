// 操作（コメント・返信・回答・編集・削除・解決・添付・Submit・終了）：POST /api/<操作>。旧 app.js の `api`＋`act`＋`refreshTopic(true)` と同じ振る舞い。
//   - 成功：`onOk(結果)` を呼び（画面の下書き・編集中の解除など。旧は、取り直しの前に、していた）、そのあと、トピックを、すぐ取り直す
//   - 失敗：トーストを出して、null を返す（例外にしない）
// 使い方：`const { comment } = useMutations(); const r = await comment({ topic, … }, { onOk: (r) => … }); if (!r) return;`
// attach（画像の保存）は、トピックの状態を変えないので、取り直さない。
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InferRequestType, InferResponseType } from 'hono/client';
import { useCallback, useMemo } from 'react';
import { toast } from '../store/ui';
import { api, read } from './client';
import { refreshTopic } from './queries';

export interface ActionOptions<R> {
  /** 成功したとき、取り直しの前に呼ぶ */
  onOk?: (result: R) => void;
}
/** 操作：本文（API の形）を渡す。失敗（トーストを出した）なら null */
export type Action<B, R> = (body: B, opts?: ActionOptions<R>) => Promise<R | null>;

type Post = (args: { json: never }) => Promise<Response>;
type Body<P extends Post> = InferRequestType<P> extends { json: infer J } ? J : never;
type Result<P extends Post> = InferResponseType<P, 200>;

function useAction<P extends Post>(
  call: (body: Body<P>) => Promise<Result<P>>,
  refresh: boolean,
): Action<Body<P>, Result<P>> {
  const qc = useQueryClient();
  const { mutateAsync } = useMutation({ mutationFn: call });
  return useCallback(
    async (body, opts) => {
      try {
        const r = await mutateAsync(body);
        opts?.onOk?.(r);
        if (refresh && typeof body === 'object' && body !== null && 'topic' in body && typeof body.topic === 'string')
          await refreshTopic(qc, body.topic);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), true);
        return null;
      }
    },
    [mutateAsync, qc, refresh],
  );
}

type ActionOf<P extends Post> = Action<Body<P>, Result<P>>;

/** 操作の一式。`delete` は、API の名前のまま */
export interface Mutations {
  comment: ActionOf<typeof api.api.comment.$post>;
  reply: ActionOf<typeof api.api.reply.$post>;
  answer: ActionOf<typeof api.api.answer.$post>;
  edit: ActionOf<typeof api.api.edit.$post>;
  delete: ActionOf<typeof api.api.delete.$post>;
  resolve: ActionOf<typeof api.api.resolve.$post>;
  attach: ActionOf<typeof api.api.attach.$post>;
  submit: ActionOf<typeof api.api.submit.$post>;
  end: ActionOf<typeof api.api.end.$post>;
}

export function useMutations(): Mutations {
  const comment = useAction<typeof api.api.comment.$post>(
    async (json) => read(await api.api.comment.$post({ json })),
    true,
  );
  const reply = useAction<typeof api.api.reply.$post>(async (json) => read(await api.api.reply.$post({ json })), true);
  const answer = useAction<typeof api.api.answer.$post>(
    async (json) => read(await api.api.answer.$post({ json })),
    true,
  );
  const edit = useAction<typeof api.api.edit.$post>(async (json) => read(await api.api.edit.$post({ json })), true);
  const remove = useAction<typeof api.api.delete.$post>(
    async (json) => read(await api.api.delete.$post({ json })),
    true,
  );
  const resolve = useAction<typeof api.api.resolve.$post>(
    async (json) => read(await api.api.resolve.$post({ json })),
    true,
  );
  const attach = useAction<typeof api.api.attach.$post>(
    async (json) => read(await api.api.attach.$post({ json })),
    false,
  );
  const submit = useAction<typeof api.api.submit.$post>(
    async (json) => read(await api.api.submit.$post({ json })),
    true,
  );
  const end = useAction<typeof api.api.end.$post>(async (json) => read(await api.api.end.$post({ json })), true);
  return useMemo(
    () => ({ comment, reply, answer, edit, delete: remove, resolve, attach, submit, end }),
    [comment, reply, answer, edit, remove, resolve, attach, submit, end],
  );
}
