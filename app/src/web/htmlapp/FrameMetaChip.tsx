// 「枠から」の札と、枠から取った情報の行（F45）：html-app の枠の中のコードが作った情報（要素・状態・画像）を、コメントの文章ではなく、UI の「情報の行」に出す。
// 閉じた行：「枠から：要素を選びました（button・x:113 y:133 w:93 h:34）」。開くと、読み取り専用のメタデータ（セレクタ・タグ・文字・位置と大きさ・見た目の値・状態）。
// **すべて、React の子（文字）として描く**（`innerHTML`・`dangerouslySetInnerHTML` は、使わない）。値は、検査・見える化（`reveal`）を通ったもの（`parseFrameMeta`。サーバーも同じ）。
// 下書き（`onRemove` あり）では、「外す」で、この情報だけを外せる（錨・本文は残る）。送信後のカード（`onRemove` なし）は、見るだけ。
import { ChevronRight, X } from 'lucide-react';
import { useId, useState } from 'react';
import { frameMetaSummary } from '../../shared/htmlapp-bridge';
import type { FrameMeta, FramePick } from '../../shared/types';

/** 「枠から」の札：枠の中のコードが作った情報（要素・状態・画像）が入っているコメント。AI の文章・あなたの文章と、見分ける（F42・F45）。色だけに頼らず、文字で書く */
export function FromFrame() {
  return (
    <span
      className="chip small fromframe"
      title="html-app の枠の中のコードが作った情報が、付いています（要素・状態・画像）"
    >
      枠から
    </span>
  );
}

/**
 * 状態（JSON の文字列）を、読みやすく整える（読めなければ、そのまま：文字として出す）。
 * 見える化した文字（`\u{E0049}`・`\u202E`）は、JSON の文字列として書き直すと `\` が 2 つになるので、1 つに戻す（見える化は、表示のための印：二重にしない）
 */
function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2).replace(/\\\\u(\{[0-9A-F]{5,6}\}|[0-9A-F]{4})/g, '\\u$1');
  } catch {
    return json;
  }
}

/** 選んだ要素の、読み取り用の表 */
function PickTable({ pick }: { pick: FramePick }) {
  const { x, y, w, h } = pick.rect;
  const styles = Object.entries(pick.styles);
  return (
    <dl className="fm-dl">
      <dt>セレクタ</dt>
      <dd>
        <code>{pick.selector}</code>
      </dd>
      <dt>タグ</dt>
      <dd>
        <code>{pick.tag}</code>
      </dd>
      <dt>文字</dt>
      <dd>{pick.text || '（なし）'}</dd>
      <dt>位置と大きさ</dt>
      <dd>
        x:{x} y:{y} w:{w} h:{h}（枠の大きさ {pick.frame.w}×{pick.frame.h}）
      </dd>
      <dt>見た目</dt>
      <dd>
        {styles.length ? (
          <ul className="fm-styles">
            {styles.map(([k, v]) => (
              <li key={k}>
                <span className="fm-k">{k}</span>
                <code>{v}</code>
              </li>
            ))}
          </ul>
        ) : (
          '（なし）'
        )}
      </dd>
    </dl>
  );
}

interface Props {
  meta: FrameMeta;
  /** 下書きのとき：メタデータだけを外す（元に戻せない）。送信後のカードでは、渡さない */
  onRemove?: () => void;
  /** 行の中に「枠から」の札を出すか（既定：出す）。送信後のカードは、見出しに札があるので、出さない（札が、二重にならない） */
  showTag?: boolean;
}

export function FrameMetaChip({ meta, onRemove, showTag = true }: Props) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className="framemeta" data-open={open ? '' : undefined}>
      <div className="fm-row">
        <button
          type="button"
          className={showTag ? 'fm-toggle tagged' : 'fm-toggle'}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          title={open ? '枠から取った情報を、たたむ' : '枠から取った情報を、開いて見る'}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight aria-hidden="true" focusable="false" />
          {showTag ? <FromFrame /> : null}
          <span className="fm-sum">{frameMetaSummary(meta)}</span>
        </button>
        {onRemove ? (
          <button
            type="button"
            className="ghost small fm-remove"
            title="この情報だけを外します（対象・本文は、そのまま。元には戻せません）"
            onClick={onRemove}
          >
            <X aria-hidden="true" focusable="false" />
            外す
          </button>
        ) : null}
      </div>
      {open ? (
        <section className="fm-body" id={bodyId} aria-label="枠から取った情報（読み取り専用）">
          <p className="hint">
            枠の中のコードが作った情報です（自己申告）。あなたの言葉ではなく、実際に押した要素と違うことがあります。読み取り専用です。
          </p>
          {meta.pick ? <PickTable pick={meta.pick} /> : null}
          {meta.state !== undefined ? (
            <div className="fm-state">
              <div className="fm-h">枠の状態</div>
              <pre>{prettyJson(meta.state)}</pre>
            </div>
          ) : null}
          {meta.imageFromFrame ? (
            <p className="fm-image">
              添付の画像は、枠の中のコードが作ったものです（枠が決めた内容で、実際の見た目と違うことがあります）。
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
