// 「Markdown を保存」（上のバー `#top`）：いま見ているページ・版の、元の Markdown を、ファイルとして保存する（ブラウザの中で完結：`lib/download.ts`）。
// 変更を重ねていても、差分の装飾は入らない・コメントは含まない・画像は `assets/…` の参照のまま。本文は、App が本文の描画のために取っているもの（`usePage`：同じキー・同じ写し。サーバーへ、新しく取りに行かない）を、受け取る（上のバーの部品が、TanStack Query に直接、依存しない）。
// 本文が届くまで（取得に失敗しているあいだも）押せない（前の版を、新しい版の名前で保存しない）。並べて比べる画面では、左右のどちらか決まらないので、出さない。
// 見た目は、上のバーの、ほかのアイコンのボタン（ベル・外観・☰）と同じ（`iconbtn`：26px・枠なし・同じフォーカスの輪）。どの幅でも、アイコンだけ（利用者の判断：統一感）。名前は `aria-label`（読み上げ）と `title`（ホバー）。
// 置き場所が上のバー：本文の上のバー（`#docbar`）は、過去の版・件数・切り替えで、1360px・右のコメント 380 でも、もう 1 行に余白がない（ラベル付きの 140px が入らない）。
// 版が 1 つの、子でないページでは、`#docbar` は出さない（0.28.0）ので、そこでも使える場所が、必要だった。
import { Download } from 'lucide-react';
import { markdownFileName, saveText } from '../lib/download';
import { SAVE_FAILED } from '../lib/messages';
import type { View } from '../lib/view';
import { toast, useUi } from '../store/ui';

export interface SaveSource {
  /** いま見ているページ・版の本文（届くまで undefined。空の本文は ''：空のファイルとして、保存できる） */
  markdown: string | undefined;
  /** 本文の取得に失敗している */
  failed: boolean;
}

export function SaveMarkdown({ view, source }: { view: View; source: SaveSource }) {
  const comparing = useUi((s) => s.compare !== null);
  if (comparing) return null;
  const { slug, page, version } = view;
  const { markdown, failed } = source;
  const name = markdownFileName(slug, page, version);
  const title =
    markdown !== undefined
      ? `Markdown を保存：このページの、いま見ている版（v${version}）を、${name} として保存します（コメントは含みません）`
      : failed
        ? '本文を取得できないため、保存できません'
        : '本文を読み込み中です';
  return (
    <button
      type="button"
      id="btn-save-md"
      className="iconbtn"
      title={title}
      aria-label="Markdown を保存"
      disabled={markdown === undefined}
      onClick={() => {
        if (markdown === undefined) return;
        try {
          saveText(name, markdown);
        } catch {
          toast(SAVE_FAILED, true);
        }
      }}
    >
      <Download aria-hidden="true" focusable="false" />
    </button>
  );
}
