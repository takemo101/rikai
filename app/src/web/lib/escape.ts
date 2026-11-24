// Esc の順序（1 か所）。本文の範囲選択（interact）と、拡大表示（ライトボックス：`#lightbox`）の、どちらの keydown リスナーが先に受けても、同じ順で、1 回の押下につき 1 度だけ処理する。
//   1. 本文の範囲を選んでいる → やめる
//   2. 範囲の枠（入力中の対象）をドラッグしている → 何もしない（元に戻すのは、枠を持つ overlay：Overlays.tsx）
//   3. 拡大表示が開いている：道具（ステージの範囲選択・html-app の要素選択）が動いていれば、**その中止だけ**（入力欄の下書きは、触らない）→ もう一度で、閉じる（ドックの中の添付の画像を重ねて開いているときは、その 1 段だけ閉じて、ドックつきの拡大表示へ戻る）
//   4. 版を並べて比べる画面（F44）が開いている → 閉じる（拡大表示は、比較の画面からは開けない。左の一覧のドロワー・ダイアログが開いているときは、それらが先に閉じる：ここでは、閉じない）
// 変換中（`isComposing`・`keyCode 229`）の Esc は、処理しない（橋の `esc` の転送・要素選択の中止も、同じ）。
// 入力欄の書きかけ（`drafts.composer`）は、閉じても、消えない：右のパネルに残り、パネルの Submit で送る（F43）。
import { cancelAllPicks } from '../htmlapp/framePick';
import { useUi } from '../store/ui';
import { isImeKey } from './keys';

const handled = new WeakSet<Event>();

/** Esc を処理する。何かを閉じた・止めた（または、ドラッグ中で、任せた）ときは true。同じ押下（`e`）を、2 度は処理しない（2 度目は、false） */
export function escapeStep(e?: Event): boolean {
  // 日本語などの変換中（IME）の Esc は、変換の取り消し：閉じない・道具を止めない（`keyCode 229` は、変換中の印）
  if (e instanceof KeyboardEvent && isImeKey(e)) return false;
  if (e) {
    if (handled.has(e)) return false;
    handled.add(e);
  }
  const s = useUi.getState();
  if (s.regMode === 'selecting') {
    s.setRegMode('idle');
    return true;
  }
  if (s.regDrag) return true;
  if (s.lightbox) {
    if (s.focusTool !== 'idle') {
      s.setFocusTool('idle');
      return true;
    }
    if (cancelAllPicks()) return true;
    s.closeLightbox();
    return true;
  }
  if (s.compare && !s.narrowSideOpen && !s.dialog) {
    s.closeCompare();
    return true;
  }
  return false;
}
