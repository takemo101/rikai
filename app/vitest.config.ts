import { defineConfig } from 'vitest/config';
import { versionDefine } from './scripts/version';

export default defineConfig({
  define: versionDefine,
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    globalSetup: ['test/setup/htmlapp-worker.ts', 'test/setup/cli.ts'],
    // 画面（test/web）は、ファイルごとに `// @vitest-environment jsdom`。その環境でだけ、DOM の掃除・jest-dom を入れる
    setupFiles: ['test/setup/web.ts'],
  },
});
