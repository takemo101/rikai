// HTTP の POST /api/<操作> のリクエストの形（Zod）。型のための、ゆるい形だけ。
// 意味の検査（長さ・値の範囲・存在・状態）と、エラーの文言は、サーバーの actions・norm* が行う（旧実装のまま）。
// 値の型は、旧実装が実行時に受けていた範囲（数の文字列など）に合わせて、ゆるくしてある。
import { z } from 'zod';

const topic = z.string();
const thread = z.string();
const msg = z.string();

export const attachBody = z.object({ topic, data: z.unknown() });
export const commentBody = z.object({
  topic,
  page: z.string(),
  version: z.union([z.number(), z.string()]),
  anchor: z.unknown().optional(),
  text: z.unknown().optional(),
  images: z.unknown().optional(),
});
export const replyBody = z.object({ topic, thread, text: z.unknown().optional(), images: z.unknown().optional() });
export const answerBody = z.object({ topic, thread, msg, answer: z.unknown().optional() });
export const editBody = z.object({ topic, thread, msg, text: z.unknown().optional() });
export const deleteBody = z.object({ topic, thread, msg });
export const resolveBody = z.object({ topic, thread, resolved: z.unknown().optional() });
export const submitBody = z.object({ topic, note: z.unknown().optional() });
export const endBody = z.object({ topic });

/** 操作名は、actions のキーと同じ */
export const apiBodies = {
  attach: attachBody,
  comment: commentBody,
  reply: replyBody,
  answer: answerBody,
  edit: editBody,
  delete: deleteBody,
  resolve: resolveBody,
  submit: submitBody,
  end: endBody,
} as const;

/** `GET /api/topic/<slug>` の問い合わせ：画面が前に受け取った rev（同じなら、`{ unchanged: true }` だけが返る） */
export const topicQuery = z.object({ since: z.string().optional() });

export type ApiName = keyof typeof apiBodies;
export type AttachBody = z.infer<typeof attachBody>;
export type CommentBody = z.infer<typeof commentBody>;
export type ReplyBody = z.infer<typeof replyBody>;
export type AnswerBody = z.infer<typeof answerBody>;
export type EditBody = z.infer<typeof editBody>;
export type DeleteBody = z.infer<typeof deleteBody>;
export type ResolveBody = z.infer<typeof resolveBody>;
export type SubmitBody = z.infer<typeof submitBody>;
export type EndBody = z.infer<typeof endBody>;
