// 画面のバンドル（Vite）に入った npm のパッケージの、ライセンスを集めて、`THIRD-PARTY-LICENSES.txt` として、出力に添える（SPEC N5）。
// 出力は、並べ順を決めて、同じ入力なら同じ内容にする（`test/build.test.ts` が、コミットしたものと比べる）。
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export function licensesPlugin(): Plugin {
  return {
    name: 'rikai-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Map<string, string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const id of item.moduleIds) {
          if (id.includes('\0')) continue;
          // pnpm は、node_modules/.pnpm/<名前@版>/node_modules/<名前>/ に置く。最後の node_modules/ の次が、パッケージ
          const at = id.lastIndexOf('node_modules/');
          if (at === -1) continue;
          const m = /^((?:@[^/]+\/)?[^/]+)\//.exec(id.slice(at + 'node_modules/'.length));
          if (!m?.[1]) continue;
          packages.set(m[1], path.join(id.slice(0, at + 'node_modules/'.length), m[1]));
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
        sections.push(`### ${name} ${pkg.version ?? ''}\n\n${text}\n`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-LICENSES.txt',
        source: `画面（skills/rikai/public/）にバンドルした依存のライセンス（ビルドのたびに、生成する）\n\n${sections.join('\n')}`,
      });
    },
  };
}
