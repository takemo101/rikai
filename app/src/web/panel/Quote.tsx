// カード・入力欄の「対象」の行（`.quote`）。選んだ文（`quote`）は、複数行でよい（90 字まで）。**位置の名前（`label`：範囲・ブロック・枠）は、1 行に収める**：
// 長い名前（「範囲：実行できる枠 1（隔離されています。…（枠の幅 980px で選択）（枠の画像は、枠自身が作ったもの）」）が、2〜3 行を占めないように。省略した分は、`title` に全文。
// 保存するラベルの形は、変えない（表示だけ）。
import type { Anchor } from '../../shared/types';
import { trunc } from '../lib/dom';

export function Quote({ anchor, text }: { anchor: Pick<Anchor, 'quote'> | null; text: string }) {
  const isLabel = !anchor?.quote;
  return (
    <div className={isLabel ? 'quote qlabel' : 'quote'} {...(isLabel ? { title: text } : {})}>
      {trunc(text, 90)}
    </div>
  );
}
