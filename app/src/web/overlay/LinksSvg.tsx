// 関連の線（F35・F55）を描く（本文の `#links`・拡大表示の `svg.fv-links` で共用）。組み立てた `Frame` を、SVG にするだけ：図形だけで、文字は描かない・読み上げない（`aria-hidden`）・押せない（CSS）。
// `clipId`：`<clipPath>` の ID の接頭辞。本文と拡大表示の線が、同じ文書に同時にあるので、ID が重ならないようにする（拡大表示の中の ID は、`zoom-` で始める：`#lightbox` の約束）。

import { right } from '../lib/geom';
import type { Frame, Link } from './connectorPath';
import { PENDING } from './linkFrame';

export function LinksSvg({
  id,
  className,
  clipId,
  frame,
  active,
  linked,
  resolved,
}: {
  /** `<svg>` の `id`（本文の `links`）。拡大表示の線は、持たない（`#lightbox` の中の ID は、`zoom-` で始める約束）：`className` で見分ける */
  id?: string;
  /** `<svg>` の、見た目の種類（拡大表示の `fv-links`） */
  className?: string;
  /** `<clipPath>` の ID の接頭辞（`links` → `links-clip`・`links-s`） */
  clipId: string;
  frame: Frame;
  active: string | null;
  linked: string | null;
  /** 解決済みのスレッド（薄く描く） */
  resolved: ReadonlySet<string>;
}) {
  const { clip } = frame;
  const weight = (l: Link): number => (l.tid === active || l.tid === linked ? 2 : l.tid === PENDING ? 1 : 0);
  const links = [...frame.links].sort((a, b) => weight(a) - weight(b)); // 強調する線は、手前（あとに描く）
  const focus = links.some((l) => weight(l) === 2);
  return (
    <svg id={id} className={[className, focus && 'focus'].filter(Boolean).join(' ') || undefined} aria-hidden="true">
      <defs>
        <clipPath id={`${clipId}-clip`}>
          <rect x={clip.left} y={clip.top} width={clip.width} height={clip.height} />
        </clipPath>
        {/* 引き出し線のある線の、S 字の部分だけ（x が、共通の x から右）：引き出しの部分は、別の線（.cn-lead）で、薄い点線に描く */}
        {frame.leadX !== null ? (
          <clipPath id={`${clipId}-s`}>
            <rect x={frame.leadX} y={clip.top} width={Math.max(0, right(clip) - frame.leadX)} height={clip.height} />
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={`url(#${clipId}-clip)`}>
        {links.map((l) => {
          const cls = [
            'cn-g',
            l.tid === active && 'active',
            l.tid === linked && 'linked',
            l.tid === PENDING && 'pending',
            resolved.has(l.tid) && 'resolved',
            l.edge && 'edge',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g key={l.tid} className={cls} data-tid={l.tid}>
              {l.lead ? <path className="cn-lead" d={l.d.slice(0, l.d.lastIndexOf('C'))} /> : null}
              <path className="cn" data-tid={l.tid} d={l.d} clipPath={l.lead ? `url(#${clipId}-s)` : undefined} />
              {l.doc ? <circle className="cn-dot" cx={l.doc.x} cy={l.doc.y} r={3} /> : null}
              {l.card ? (
                <line className="cn-bar" x1={l.card.x} y1={l.card.y - 5} x2={l.card.x} y2={l.card.y + 5} />
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
