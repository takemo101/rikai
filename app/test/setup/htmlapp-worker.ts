// html-app の worker（ビルド済みの JS が要る）を、テストの前に 1 回ビルドして、場所を環境変数で伝える
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export default async function setup(): Promise<void> {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outfile = path.join(app, '.build', 'rikai-htmlapp-worker.js');
  await build({
    absWorkingDir: app,
    entryPoints: ['src/server/htmlapp-worker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    logLevel: 'silent',
  });
  process.env.RIKAI_HTMLAPP_WORKER = outfile;
}
