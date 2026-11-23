// 対象を失った下書き（F44）：比べる画面を開いている間に新しい版が届き、書きかけのコメントの対象が、新しい版で見つからなくなったとき。
// 書きかけの文を、**別の対象に付けない**（次に開く入力欄には、入れない）：パネルの上に、注記つきで 1 件だけ出し、利用者が、コピー・破棄を選ぶ。文は、文字として出す（React の子）。
import { Copy, Trash2 } from 'lucide-react';
import { toast, useUi } from '../store/ui';

export function LostDraft() {
  const lost = useUi((s) => s.lostDraft);
  if (!lost) return null;
  const copy = (): void => {
    const clip = navigator.clipboard;
    if (!clip) {
      toast('コピーできませんでした。文を選んで、コピーしてください', true);
      return;
    }
    clip.writeText(lost.text).then(
      () => toast('文をコピーしました'),
      () => toast('コピーできませんでした。文を選んで、コピーしてください', true),
    );
  };
  return (
    <section className="lostdraft" aria-label="対象を失った下書き" data-lost-draft>
      <div className="lostdraft-h">対象を失った下書き</div>
      <p className="hint">
        書きかけのコメントの対象が、{lost.reason}
        。別の対象に付かないよう、入力欄には入れていません。必要なら、コピーして、新しい入力欄に貼ってください。
      </p>
      {lost.text ? <pre className="lostdraft-text">{lost.text}</pre> : null}
      {lost.imgs.length ? (
        <p className="hint">添付していた画像：{lost.imgs.length} 枚（コピーできません。破棄すると、外れます）</p>
      ) : null}
      <div className="row">
        <button type="button" className="ghost" disabled={!lost.text} onClick={copy}>
          <Copy aria-hidden="true" focusable="false" />
          コピー
        </button>
        <button type="button" className="ghost" onClick={() => useUi.getState().discardLostDraft()}>
          <Trash2 aria-hidden="true" focusable="false" />
          破棄
        </button>
      </div>
    </section>
  );
}
