// 添付の画像：入力欄の下の帯（`ImageBar`：`.imgbar`。サムネイル〔×で外す〕・アップロード中の表示。なければ出さない）と、
// 操作の行に置く「画像を付ける」のアイコンボタン（`AttachButton`）。
// サムネイルを押すと、ライトボックスで大きく出る（ThreadsPanel の、パネル全体のクリックの受け口）。
import { ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';
import { IMG_TYPES } from '../../shared/image';
import { useUi } from '../store/ui';
import { imgUrl } from './logic';
import { useDraftImgs, useImageAttach } from './useImageAttach';

interface Props {
  /** 入力欄のキー（`composer`・`reply-<スレッド ID>`） */
  imgKey: string;
  slug: string;
}

export function ImageBar({ imgKey, slug }: Props) {
  const names = useDraftImgs(imgKey);
  const uploading = useUi((s) => (s.uploadingBy[imgKey] ?? 0) > 0); // この入力欄に付けている間だけ（ほかのカードは、伸びない）
  const removeDraftImg = useUi((s) => s.removeDraftImg);
  if (!names.length && !uploading) return null;

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
            <X aria-hidden="true" focusable="false" />
          </button>
        </span>
      ))}
      {uploading ? <span className="sl">アップロード中…</span> : null}
    </div>
  );
}

/** 「画像を付ける」：ファイル選択（隠した `<input type=file>` つき）。貼り付け・ドラッグでも付けられる */
export function AttachButton({ imgKey, slug }: Props) {
  const { attachFiles } = useImageAttach(imgKey, slug);
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        className="iconbtn attach"
        title="画像を付ける（ファイルを選ぶ。貼り付け〔⌘/Ctrl+V〕・ドラッグでも付けられます）"
        aria-label="画像を付ける"
        onClick={() => input.current?.click()}
      >
        <ImagePlus aria-hidden="true" focusable="false" />
      </button>
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
    </>
  );
}
