// CLI を、子プロセスで動かすテストのために、配布と同じやり方（1 つの CJS）でバンドルして、場所を環境変数で伝える。
// skills/rikai/ には書かない（配布物は pnpm run build が出す）。html-app の worker は、同じ場所（.build/）に、
// htmlapp-worker.ts の setup が置く（バンドルの rikai.js は、自分の __dirname の rikai-htmlapp-worker.js を探す）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export default async function setup(): Promise<void> {
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outfile = path.join(app, '.build', 'rikai.js');
  // app/ は "type": "module"。バンドルは CJS なので、.build/ の中の .js を、CJS として読ませる（worker のバンドルも同じ）
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(outfile), 'package.json'), '{ "type": "commonjs" }\n');
  await build({
    absWorkingDir: app,
    entryPoints: ['src/cli/main.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    legalComments: 'none',
    logLevel: 'silent',
  });
  process.env.RIKAI_CLI = outfile;
}
