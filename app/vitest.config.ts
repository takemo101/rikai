import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/setup/htmlapp-worker.ts', 'test/setup/cli.ts'],
  },
});
