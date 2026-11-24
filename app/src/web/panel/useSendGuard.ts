// 入力欄の「追加」（新しいコメント・返信）の、共通の入口。2 回押し（同じ文が 2 件になる）・アップロード中・空の送信を、同じ順で止める。
// 順序：送っている間（busy）→ アップロード中（トースト）→ 空（何もしない。`onEmpty` で、知らせる）→ 送る → 終わったら、必ず busy を外す。
// 保存できたときの掃除（下書き・画像を消す）は、`send` の `onOk`（`useMutations`）が行う：入力欄ごとに違う（コメントは、入力欄の世代を確かめる）。
import { useRef } from 'react';
import { UPLOADING_NOW } from '../lib/messages';
import { toast, useUi } from '../store/ui';

interface SendInput {
  /** 入力中の文（前後の空白は、ここで除く） */
  draft: string;
  /** 付けた画像の枚数（画像だけでも送れる） */
  imgCount: number;
  /** 文も画像もないとき（既定は、何もしない）。送れない理由を、知らせたいときだけ */
  onEmpty?: () => void;
}

/** 返す関数：`send(text)` は、止められなかったときだけ呼ばれる（`text`：前後の空白を除いた文） */
export function useSendGuard(): (input: SendInput, send: (text: string) => Promise<void>) => Promise<void> {
  const busy = useRef(false);
  return async ({ draft, imgCount, onEmpty }, send) => {
    if (busy.current) return;
    const text = draft.trim();
    if (useUi.getState().uploading) {
      toast(UPLOADING_NOW, true);
      return;
    }
    if (!text && !imgCount) {
      onEmpty?.();
      return;
    }
    busy.current = true;
    try {
      await send(text);
    } finally {
      busy.current = false;
    }
  };
}
