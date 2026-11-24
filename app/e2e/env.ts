// e2e の実行環境（設定とフィクスチャで共有する）。
// RIKAI_CHROME：使う Chrome の実行ファイル。なければ、一般的な場所（macOS の /Applications・Linux は PATH の google-chrome・chromium など）から探す。
//   どちらにもなければ、空（テストは skip。ブラウザのダウンロードはしない）
// RIKAI_CLI：試す対象の rikai.js（バンドルした CLI。画面〔public/〕は、その隣から配られる）。既定は、リポジトリの skills/rikai/rikai.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PATH_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

function findChrome(): string {
  if (fs.existsSync(MAC_CHROME)) return MAC_CHROME;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const name of PATH_NAMES) {
      const file = path.join(dir, name);
      if (dir && fs.existsSync(file)) return file;
    }
  }
  return '';
}

export const CHROME: string = process.env.RIKAI_CHROME || findChrome();
export const CLI: string = path.resolve(process.env.RIKAI_CLI || path.join(here, '../../skills/rikai/rikai.js'));
