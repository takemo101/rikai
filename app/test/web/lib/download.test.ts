// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { markdownFileName, saveText } from '../../../src/web/lib/download';

afterEach(() => vi.restoreAllMocks());

test('ファイル名：<トピック>-<ページ>-v<版>.md。root ページは、ページ名を省く', () => {
  expect(markdownFileName('cat-diary', 'root', 3)).toBe('cat-diary-v3.md');
  expect(markdownFileName('cat-diary', 'feeding-2', 1)).toBe('cat-diary-feeding-2-v1.md');
  expect(markdownFileName('a', 'b', 12)).toBe('a-b-v12.md');
});

test('ファイル名の消毒：パス区切り・ドット・空白・制御文字・非 ASCII は、1 つの `-` になる（保存先を変えない・隠しファイルにしない）', () => {
  expect(markdownFileName('../../etc/passwd', 'root', 1)).toBe('etc-passwd-v1.md');
  expect(markdownFileName('a\\b', 'c/d', 2)).toBe('a-b-c-d-v2.md');
  expect(markdownFileName('.hidden', 'root', 1)).toBe('hidden-v1.md');
  expect(markdownFileName('a b\tc\u0000d\u202ee', 'root', 1)).toBe('a-b-c-d-e-v1.md');
  expect(markdownFileName('猫の日記-cat', 'root', 1)).toBe('cat-v1.md');
  expect(markdownFileName('x', '子ページ 1', 1)).toBe('x-1-v1.md');
  // ファイル名の区切りに、`/` `\` `:` 制御文字・`..` が残らない
  const n = markdownFileName('../a:b*c?"<>|', '..\\..', 9);
  expect(n).toMatch(/^[A-Za-z0-9][A-Za-z0-9-]*\.md$/);
  expect(n).not.toContain('..');
});

test('ファイル名：何も残らないときは、topic・page に置き換える（空のファイル名・`-v1.md` だけの名前にしない）', () => {
  expect(markdownFileName('猫', '犬', 1)).toBe('topic-page-v1.md');
  expect(markdownFileName('///', 'root', 1)).toBe('topic-v1.md');
});

/** `Blob` の中身を、バイト列で読む（jsdom の Blob には `arrayBuffer()` がない） */
const bytesOf = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

function stubBlobUrl() {
  const blobs: Blob[] = [];
  const events: string[] = [];
  const create = vi.fn((b: Blob) => {
    blobs.push(b);
    events.push('create');
    return 'blob:fake/1';
  });
  const revoke = vi.fn((u: string) => events.push(`revoke:${u}`));
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  return { blobs, events, create, revoke };
}

test('保存：非表示の <a download> を押して、すぐ取り除く。Blob の URL は、押した直後に解く。内容は、元のバイト列（BOM・CRLF・日本語・末尾の改行なし）', async () => {
  const { blobs, events, revoke } = stubBlobUrl();
  let seen: { href: string; download: string; inDom: boolean; hidden: boolean } | null = null;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    events.push('click');
    seen = { href: this.href, download: this.download, inDom: this.isConnected, hidden: Boolean(this.hidden) };
  });
  const text = '\uFEFF# 題\r\n\r\n猫は朝によく鳴く。\r\n- 項目\r\nお尻に改行なし';
  saveText('cat-v1.md', text);
  expect(seen).toEqual({ href: 'blob:fake/1', download: 'cat-v1.md', inDom: true, hidden: true });
  expect(document.querySelector('a[download]')).toBeNull(); // 取り除いた
  expect(events).toEqual(['create', 'click', 'revoke:blob:fake/1']); // 解くのは、押したあと
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(blobs[0]?.type).toBe('text/markdown;charset=utf-8');
  expect(Array.from((await bytesOf(blobs[0] as Blob)).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM を、落とさない
  expect(Buffer.from(await bytesOf(blobs[0] as Blob)).equals(Buffer.from(text, 'utf8'))).toBe(true);
});

test('保存：空の本文も、空のファイルとして保存する（Blob の URL は、解く）', async () => {
  const { blobs, revoke } = stubBlobUrl();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  saveText('empty-v1.md', '');
  expect((await bytesOf(blobs[0] as Blob)).length).toBe(0);
  expect(revoke).toHaveBeenCalledTimes(1);
});

test('保存：押すところで失敗しても、Blob の URL は解き、<a> は取り除く。失敗は、握りつぶさず、投げる（呼ぶ側が、トーストで知らせる）', () => {
  const { revoke } = stubBlobUrl();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => saveText('x-v1.md', 'a')).toThrow('blocked');
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(document.querySelector('a[download]')).toBeNull(); // 押せなくても、<a> を残さない
});
