// 画面のバンドル（Vite）に入った npm のパッケージの、ライセンスを集めて、`THIRD-PARTY-LICENSES.txt` として、出力に添える（SPEC N5）。
// 出力は、並べ順を決めて、同じ入力なら同じ内容にする（`test/build.test.ts` が、コミットしたものと比べる）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** KaTeX のフォント（woff2 を、画面に同梱する）のライセンス：SIL OFL 1.1（`katex` パッケージの LICENSE は、コードの MIT だけ。フォントの表示・権利は、フォントのメタデータにある） */
const KATEX_FONTS_LICENSE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'katex-fonts-license.txt');

export function licensesPlugin(): Plugin {
  return {
    name: 'rikai-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      // 鍵は「名前@版」（同じ名前の別の版が、バンドルに 2 つ入ることがある。名前だけを鍵にすると、片方のライセンスが、抜ける）
      const packages = new Map<string, { name: string; version: string; dir: string; pkg: { license?: string } }>();
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        for (const id of item.moduleIds) {
          if (id.includes('\0')) continue;
          // pnpm は、node_modules/.pnpm/<名前@版>/node_modules/<名前>/ に置く。最後の node_modules/ の次が、パッケージ
          const at = id.lastIndexOf('node_modules/');
          if (at === -1) continue;
          const m = /^((?:@[^/]+\/)?[^/]+)\//.exec(id.slice(at + 'node_modules/'.length));
          if (!m?.[1]) continue;
          const dir = path.join(id.slice(0, at + 'node_modules/'.length), m[1]);
          const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
            version?: string;
            license?: string;
          };
          const version = pkg.version ?? '';
          packages.set(`${m[1]}@${version}`, { name: m[1], version, dir, pkg });
        }
      }
      const sections: string[] = [];
      const ordered = [...packages.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, 'en', { numeric: true }),
      );
      for (const { name, version, dir, pkg } of ordered) {
        const file = fs.readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f));
        // ライセンスのファイルがないパッケージは、package.json の license（SPDX の識別子）を書く
        const text = file
          ? fs.readFileSync(path.join(dir, file), 'utf8').trim()
          : `ライセンス：${pkg.license ?? '（不明）'}（パッケージに、全文のファイルがない。package.json の license）`;
        sections.push(`### ${name} ${version}\n\n${text}\n`);
        if (name === 'katex')
          sections.push(`### katex ${version} のフォント\n\n${fs.readFileSync(KATEX_FONTS_LICENSE, 'utf8').trim()}\n`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-LICENSES.txt',
        source: `画面（skills/rikai/public/）にバンドルした依存のライセンス（ビルドのたびに、生成する）\n\n${sections.join('\n')}`,
      });
    },
  };
}
