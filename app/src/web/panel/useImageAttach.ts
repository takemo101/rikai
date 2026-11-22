// コメント・返信への画像の添付（F24）。貼り付け（⌘/Ctrl+V。OS のスクリーンショットも）・ドラッグ・ファイル選択で付ける。
// 付けた時点で、サーバーが assets/ に保存し、名前を返す。送るまでは、×で外せる（外しても、保存したファイルは残る。同じ画像は、同じ名前なので、増えない）。
// 終わりが遅れたアップロード：入力欄の世代（`imgGen`）と、トピックを確かめ、別の入力欄に付かないようにする。
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';
import { useCallback, useMemo } from 'react';
import { useMutations } from '../api/mutations';
import { parseHash } from '../lib/route';
import { toast, useUi } from '../store/ui';
import { checkImage, IMG_MAX_N } from './logic';

const EMPTY: readonly string[] = [];

function readBase64(file: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
  return promise;
}

/** 付けた画像の名前（その入力欄の分） */
export const useDraftImgs = (key: string): readonly string[] => useUi((s) => s.drafts.imgs[key] ?? EMPTY);

const hasFiles = (dt: DataTransfer | null): boolean => !!dt && [...dt.types].includes('Files');

export interface ImageAttach {
  /** 検査して、1 枚ずつ、アップロードして付ける */
  attachFiles: (files: readonly File[]) => Promise<void>;
  /** 入力欄（textarea）に付ける：画像だけの貼り付け・ファイルのドラッグを受ける（文字の貼り付けは、そのまま通す） */
  handlers: {
    onPaste: (e: ReactClipboardEvent<HTMLElement>) => void;
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void;
    onDrop: (e: ReactDragEvent<HTMLElement>) => void;
  };
}

/** `key`：入力欄のキー（`composer`・`reply-<スレッド ID>`）。`slug`：付ける画像の保存先のトピック */
export function useImageAttach(key: string, slug: string): ImageAttach {
  const { attach } = useMutations();

  const attachFiles = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const ui = () => useUi.getState();
      for (const f of files) {
        const bad = checkImage(f, (ui().drafts.imgs[key] ?? []).length);
        if (bad) {
          toast(bad.message, true);
          if (bad.reason === 'count') break;
          continue;
        }
        const gen = ui().imgGen[key] ?? 0;
        ui().beginUpload();
        let name: string | null = null;
        try {
          const r = await attach({ topic: slug, data: await readBase64(f) });
          name = r ? r.name : null;
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), true);
        } finally {
          ui().endUpload();
        }
        // 終わるまでに、入力欄をやめた・送った・別のトピックへ移った、なら、この画像は、付けない（別の入力欄に、出ないように）。
        // 続けて何枚も貼ると、上の枚数の検査は、完了を待たずに通るので、付ける直前に、もう一度、上限を見る
        if (
          name !== null &&
          slug === parseHash(location.hash)?.slug &&
          gen === (ui().imgGen[key] ?? 0) &&
          (ui().drafts.imgs[key] ?? []).length < IMG_MAX_N
        )
          ui().addDraftImg(key, name);
      }
    },
    [attach, key, slug],
  );

  const handlers = useMemo<ImageAttach['handlers']>(
    () => ({
      onPaste: (e) => {
        const cd = e.clipboardData;
        const files = [...cd.files].filter((f) => f.type.startsWith('image/'));
        if (!files.length || [...cd.types].includes('text/plain')) return;
        e.preventDefault();
        void attachFiles(files);
      },
      onDragOver: (e) => {
        if (hasFiles(e.dataTransfer)) e.preventDefault();
      },
      onDrop: (e) => {
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        void attachFiles(files);
      },
    }),
    [attachFiles],
  );

  return { attachFiles, handlers };
}

/** 入力欄の外にファイルを落としても、ブラウザが、そのファイルを開いて、画面（書きかけの文）を失わないようにする */
export function preventFileDropOutside(): () => void {
  const guard = (e: DragEvent): void => {
    if (hasFiles(e.dataTransfer)) e.preventDefault();
  };
  document.addEventListener('dragover', guard);
  document.addEventListener('drop', guard);
  return () => {
    document.removeEventListener('dragover', guard);
    document.removeEventListener('drop', guard);
  };
}
