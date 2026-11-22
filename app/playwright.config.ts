// 実際のブラウザ（システムの Chrome）での e2e。ブラウザのダウンロードはしない（RIKAI_CHROME か、既定の Chrome を使う）。
// 1 つのテストにつき 1 つの使い捨てプロジェクト・サーバー（fixtures.ts）。順番に（workers 1）、1 つずつ流す。
import fs from 'node:fs';
import { defineConfig } from '@playwright/test';
import { CHROME } from './e2e/env';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    viewport: { width: 1360, height: 900 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: fs.existsSync(CHROME) ? { executablePath: CHROME, args: ['--no-sandbox'] } : {},
  },
});
