// 枠の中の要素を選ぶ（F42）：選択モードの、親の側の Esc と、一括の中止。要素を選ぶ操作そのもの・`pick` の検査は、橋（`frameBridge.ts`）・`shared/htmlapp-bridge.ts`。
import { isImeKey } from '../lib/keys';
import { type AppFrame, frames } from './frameRegistry';

/** 選択モードの枠があるあいだ、親の Esc で、中止する（枠の中の Esc は、枠が自分で中止して、知らせる） */
export function onPickKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isImeKey(e)) return; // 変換中の Esc は、変換の取り消し
  for (const f of frames) f.cancelPick();
}
export const pickingFrames = (except?: AppFrame): boolean => [...frames].some((f) => f !== except && f.get().picking);

/** 選択モードの枠が、1 つでもあれば、すべて中止して true（個別表示の Esc：道具の中止が、閉じるより先。F43）。なければ false */
export function cancelAllPicks(): boolean {
  let any = false;
  for (const f of [...frames]) {
    if (!f.get().picking) continue;
    any = true;
    f.cancelPick();
  }
  return any;
}
