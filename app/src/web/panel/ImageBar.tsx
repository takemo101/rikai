// 入力欄の下の、添付の画像の帯（`.imgbar`）：サムネイル（×で外す）・「画像を付ける」・アップロード中の表示。
// サムネイルを押すと、ライトボックスで大きく出る（ThreadsPanel の、パネル全体のクリックの受け口）。
import { useRef } from 'react';
import { useUi } from '../store/ui';
import { IMG_TYPES, imgUrl } from './logic';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  /** 入力欄のキー（`composer`・`reply-<スレッド ID>`） */
  imgKey: string;
  slug: string;
}

export function ImageBar({ imgKey, slug }: Props) {
  const names = useDraftImgs(imgKey);
  const uploading = useUi((s) => s.uploading > 0);
  const removeDraftImg = useUi((s) => s.removeDraftImg);
  const { attachFiles } = useImageAttach(imgKey, slug);
  const input = useRef<HTMLInputElement>(null);

  return (
    <div className="imgbar">
      {names.map((n) => (
        <span className="thumb" key={n}>
          <img src={imgUrl(slug, n)} alt="添付の画像" />
          <button
            type="button"
            className="x"
            title="外す"
            aria-label="画像を外す"
            onClick={() => removeDraftImg(imgKey, n)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="ghost small attach"
        title="ファイルを選ぶ。貼り付け（⌘/Ctrl+V）・ドラッグでも付けられます"
        onClick={() => input.current?.click()}
      >
        画像を付ける
      </button>
      {uploading ? <span className="sl">アップロード中…</span> : null}
      <input
        ref={input}
        type="file"
        accept={IMG_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void attachFiles(files);
        }}
      />
    </div>
  );
}
