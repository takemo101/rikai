// 配布物のビルド（SPEC N5）：サーバー・CLI を、依存を含めて 1 つのファイルにバンドルし、`skills/rikai/` に置く。
//   - skills/rikai/rikai.js                    CLI の入口（CJS。`node rikai.js` で動く。利用者の環境に、npm install は要らない）
//   - skills/rikai/rikai-htmlapp-worker.js     html-app の取り出しの worker（rikai.js の横に置く）
//   - skills/rikai/THIRD-PARTY-LICENSES.txt    バンドルに入った依存のライセンス
// 使い方：リポジトリのルートで `pnpm run build`。ビルドしたものは、コミットする（古くなっていないことは、test/build.test.ts が確かめる）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { versionDefine } from './version';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
export const skillDir = path.resolve(appDir, '..', 'skills', 'rikai');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  legalComments: 'none',
  logLevel: 'silent',
  metafile: true,
  absWorkingDir: appDir,
} as const;

/** バンドルして、outDir に、rikai.js・rikai-htmlapp-worker.js・THIRD-PARTY-LICENSES.txt を書く。バンドルに入った npm のパッケージ名を返す */
export async function bundle(outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true });
  const cli = await build({
    ...common,
    entryPoints: { rikai: 'src/cli/main.ts' },
    outdir: outDir,
    banner: { js: '#!/usr/bin/env node' },
    define: versionDefine, // 版は、ビルドのときに埋め込む（実行時にファイルを読まない：配布した 1 ファイルで動く）
  });
  const worker = await build({
    ...common,
    entryPoints: { 'rikai-htmlapp-worker': 'src/server/htmlapp-worker.ts' },
    outdir: outDir,
  });
  fs.chmodSync(path.join(outDir, 'rikai.js'), 0o755);

  // バンドルに入った npm のパッケージ（node_modules/<名前>）を集めて、ライセンスを添える
  const packages = new Map<string, string>();
  for (const meta of [cli.metafile, worker.metafile]) {
    for (const input of Object.keys(meta.inputs)) {
      // pnpm は、node_modules/.pnpm/<名前@版>/node_modules/<名前>/ に置く。最後の node_modules/ の次が、パッケージ
      const at = input.lastIndexOf('node_modules/');
      if (at === -1) continue;
      const m = /^((?:@[^/]+\/)?[^/]+)\//.exec(input.slice(at + 'node_modules/'.length));
      if (!m?.[1]) continue;
      packages.set(m[1], path.resolve(appDir, input.slice(0, at + 'node_modules/'.length), m[1]));
    }
  }
  const sections: string[] = [];
  for (const [name, dir] of [...packages].sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      version?: string;
      license?: string;
    };
    // ライセンスのファイルがないパッケージは、package.json の license（SPDX の識別子）を書く
    const text = file
      ? fs.readFileSync(path.join(dir, file), 'utf8').trim()
      : `ライセンス：${pkg.license ?? '（不明）'}（パッケージに、全文のファイルがない。package.json の license）`;
    sections.push(`## ${name} ${pkg.version ?? ''}\n\n${text}\n`);
  }
  fs.writeFileSync(
    path.join(outDir, 'THIRD-PARTY-LICENSES.txt'),
    `rikai.js にバンドルした依存のライセンス（ビルドのたびに、生成する）\n\n${sections.join('\n')}`,
  );
  return [...packages.keys()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = await bundle(skillDir);
  console.log(`ビルドしました：${skillDir}\nバンドル：${names.join('、')}`);
}
