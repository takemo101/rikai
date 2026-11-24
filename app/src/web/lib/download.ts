// Markdown の保存（ダウンロード）：ブラウザの中で完結する（サーバー・外への通信は、使わない）。画面がすでに持っている本文（`usePage` の Markdown。コメントは含まない・差分の装飾も入らない元の文字列）を、そのままファイルにする。
// 内容は、文字列を UTF-8 にしただけ（改行・BOM を変えない）。`Blob` の URL は、`click()` の直後に解く（リークさせない）。DOM は、非表示の `<a download>` を 1 つ、ごく短く足すだけ（`innerHTML` を使わない）。

/**
 * 保存するファイルの名前：`<トピック>-<ページ>-v<版>.md`（root ページは、ページ名を省く：`<トピック>-v<版>.md`）。
 * トピック名・ページ ID は、サーバーが `checkSlug`（英小文字・数字・ハイフン）で検査済み。それでも、ファイル名に使うので、英数字以外（パス区切り・`.`・制御文字・空白・非 ASCII）は、連続をまとめて `-` にして、前後の `-` を落とす
 * （先頭の `.` で隠しファイルになる・`/` `\` で保存先が変わる・OS が嫌う文字、を作らない）。残らなければ、`topic`・`page` に置き換える。
 */
export function markdownFileName(slug: string, page: string, version: number): string {
  const part = (s: string, fallback: string): string =>
    s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
  const parts = [part(slug, 'topic')];
  if (page !== 'root') parts.push(part(page, 'page'));
  parts.push(`v${version}`);
  return `${parts.join('-')}.md`;
}

/** 文字列を、`name` のファイルとして、ブラウザに保存させる（ダウンロード）。作れなければ投げる（呼ぶ側が、失敗を知らせる） */
export function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    URL.revokeObjectURL(url);
  }
}
