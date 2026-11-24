// 終了したトピックの帯（`#closedbar`）：本文の列の上端に、1 本。閲覧専用であること（コメントできない）を、言う（F54）。
// 置き場：`#doc`（本文の列）の先頭。上のバー（`#top`）にも、本文の上のバー（`#docbar`）にも、入れない：どちらも「1 行・はみ出さない」を守っていて、そこへ文を足すと、状態の札・「AI に送る」・版の切り替えが、押し出される。
// 窓が狭くて、1 行に収まらないときは、折り返す（横にはみ出さない）。読み上げ：`role="status"`（「終了」を押した直後に、出る）。
import { Lock } from 'lucide-react';
import { READ_ONLY_REASON } from '../lib/messages';
import type { View } from '../lib/view';

export function ClosedBar({ view }: { view: View | null }) {
  if (!view?.readOnly) return null;
  return (
    <div id="closedbar" role="status" title="続きを書くには、もう一度 /rikai で開き直します">
      <Lock aria-hidden="true" focusable="false" />
      <span>{READ_ONLY_REASON}</span>
    </div>
  );
}
