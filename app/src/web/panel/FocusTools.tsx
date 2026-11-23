// 個別表示（F43）のステージの上部の道具：「範囲を選ぶ」（画像・図・html-app の枠の、細かい所を、ドラッグで選んで、コメントする）。
// 状態は、ストアの `focusTool`（Esc の順序が、見る：`lib/escape.ts`）。押している間は `aria-pressed`。選び終える・もう一度押す・Esc で、やめる。
import { SquareDashed } from 'lucide-react';
import { useUi } from '../store/ui';

export function RangeTool({ enabled, reason, onStart }: { enabled: boolean; reason: string; onStart?: () => void }) {
  const on = useUi((s) => s.focusTool === 'region');
  return (
    <>
      <button
        type="button"
        className="fv-tool"
        data-tool="region"
        aria-pressed={on}
        disabled={!enabled}
        title={enabled ? '細かい所を、ドラッグで選んで、コメントします（もう一度押すか、Esc で、やめます）' : reason}
        onClick={() => {
          if (on) useUi.getState().setFocusTool('idle');
          else {
            onStart?.();
            useUi.getState().setFocusTool('region');
          }
        }}
      >
        <SquareDashed aria-hidden="true" focusable="false" />
        範囲を選ぶ
      </button>
      <span className="fv-hint" role="status" aria-live="polite">
        {on ? 'ドラッグして、範囲を選びます（Esc で、やめます）' : ''}
      </span>
    </>
  );
}
