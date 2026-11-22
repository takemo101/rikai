// 画面（test/web）だけを試す設定。globalSetup（サーバー・CLI のビルド）を使わない（並行して作業しても、ぶつからないように）
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/web/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['test/setup/web.ts'],
  },
});
