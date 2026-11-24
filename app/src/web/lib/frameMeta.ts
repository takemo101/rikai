// 枠から取った情報（`frameMeta`。F45）を、下書きに持つ形にする・送る形にする。純粋な関数（DOM・ストアに触れない）。
// 検査は `parseFrameMeta`（shared）の 1 か所：枠から届いた pick・状態は、橋（`frameBridge.ts`）で検査済みだが、下書きに入れる前に、保存・送信の形でも通す
// （サーバーが拒むものを、画面で先に断る：16KB の上限など）。
import { type PickInfo, parseFrameMeta } from '../../shared/htmlapp-bridge';
import type { FrameMeta } from '../../shared/types';

export type FrameMetaOf = { ok: true; meta: FrameMeta | undefined } | { ok: false; reason: string };

/**
 * 枠から届いた pick・状態（`stateJson`：`parseState` の出力）から、下書きに持つ `frameMeta` を作る。どちらもなければ、`meta` は undefined（ok）。
 * 保存・送信の形の検査（全体で 16KB まで）を通らなければ、`reason`（トーストに出す）
 */
export function frameMetaOf(parts: { pick?: PickInfo; stateJson?: string | null }): FrameMetaOf {
  const raw: Record<string, unknown> = {};
  if (parts.pick) raw.pick = parts.pick;
  if (parts.stateJson) raw.state = parts.stateJson;
  if (!Object.keys(raw).length) return { ok: true, meta: undefined };
  const r = parseFrameMeta(raw);
  return r.ok ? { ok: true, meta: r.meta } : { ok: false, reason: `枠から取った情報を付けられません：${r.reason}` };
}

/**
 * 入力欄が、いま送る `frameMeta`：`imageFromFrame` は、**枠の画像が、まだ添付されているとき**だけ（利用者が外した・添付に失敗したなら、外す）。
 * 残るものがなければ undefined。`regionImg`：範囲の画像として、自動で付けた画像の名前
 */
export function effectiveFrameMeta(
  frameMeta: FrameMeta | undefined,
  regionImg: string | undefined,
  imgs: readonly string[],
): FrameMeta | undefined {
  if (!frameMeta?.imageFromFrame || (regionImg !== undefined && imgs.includes(regionImg))) return frameMeta;
  const { imageFromFrame: _drop, ...rest } = frameMeta;
  return rest.pick || rest.state !== undefined ? rest : undefined;
}
