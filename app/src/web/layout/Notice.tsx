// 本文の場所に出す、案内（トピックがない・読めない形式・読み込み中）。Article がないときだけ、`#article` を、この部品が出す（本文の島ではないので、React が中身を持つ）。
export function Notice({ text }: { text: string }) {
  return (
    <article id="article" className="md">
      {text}
    </article>
  );
}

/** 案内の文言（旧 app.js の route と同じ） */
export const NOTICE = {
  noTopics: 'トピックがありません。/rikai で資料を作ってください。',
  onlyUnsupported: '読めるトピックがありません（新しい形式のトピックだけです）。rikai を更新してください。',
  unsupported: (title: string): string =>
    `「${title}」は、この rikai が読めない新しい形式です。rikai を更新してください。`,
} as const;
