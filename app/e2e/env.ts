// e2e の実行環境（設定とフィクスチャで共有する）。
// RIKAI_CHROME：使う Chrome の実行ファイル（なければ、既定の場所。どちらもなければ、テストは skip）
// RIKAI_CLI：試す対象の rikai.js（バンドルした CLI。画面〔public/〕は、その隣から配られる）。既定は、リポジトリの skills/rikai/rikai.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CHROME =
  '/Users/takemo101/.omp/puppeteer/chrome/mac_arm-150.0.7871.24/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

export const CHROME: string = process.env.RIKAI_CHROME || DEFAULT_CHROME;
export const CLI: string = path.resolve(process.env.RIKAI_CLI || path.join(here, '../../skills/rikai/rikai.js'));
