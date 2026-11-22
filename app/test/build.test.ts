// 配布物（skills/rikai/ に、コミットしたバンドル）が、ソースから、いま作り直したものと同じであること（SPEC §8：成果物が古くなっていない）
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { bundle, skillDir } from '../scripts/build';

const appDir = path.resolve(skillDir, '..', '..', 'app');

/** ディレクトリの中の、全ファイル（相対パス → 中身）。比べるための写し */
function snapshot(dir: string, base = dir, out = new Map<string, string>()): Map<string, string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, out);
    else out.set(path.relative(base, p), fs.readFileSync(p, 'utf8'));
  }
  return out;
}

test('コミットしたバンドルは、ソースから作り直したものと、同じ（古くなっていない）', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-build-'));
  try {
    await bundle(out);
    for (const f of ['rikai.js', 'rikai-htmlapp-worker.js', 'THIRD-PARTY-LICENSES.txt']) {
      const fresh = fs.readFileSync(path.join(out, f), 'utf8');
      const committed = fs.readFileSync(path.join(skillDir, f), 'utf8');
      assert.equal(committed, fresh, `${f} が、ソースと違う。\`pnpm run build\` で作り直して、コミットする`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('バンドルに入った依存の、ライセンスが添えてある', () => {
  const text = fs.readFileSync(path.join(skillDir, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  for (const name of ['hono', '@hono/node-server', 'zod', 'marked'])
    assert.match(text, new RegExp(`^## ${name} `, 'm'));
  assert.doesNotMatch(text, /ライセンス：（不明）/);
});

test('コミットした画面（skills/rikai/public/）は、ソースから作り直したものと、同じ（古くなっていない）', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-web-build-'));
  try {
    // vitest の中は NODE_ENV=test（React の開発版が入る）。本番と同じ環境で、別のプロセスで、ビルドする
    const { NODE_ENV: _drop, ...env } = process.env;
    execFileSync(
      process.execPath,
      [path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir'],
      {
        cwd: appDir,
        env,
        stdio: 'pipe',
      },
    );
    const fresh = snapshot(out);
    const committed = snapshot(path.join(skillDir, 'public'));
    assert.deepEqual(
      [...committed.keys()].sort(),
      [...fresh.keys()].sort(),
      'ファイルの一覧が違う。`pnpm run build:web` で作り直して、コミットする',
    );
    for (const [file, text] of fresh)
      assert.equal(
        committed.get(file),
        text,
        `${file} が、ソースと違う。\`pnpm run build:web\` で作り直して、コミットする`,
      );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}, 60_000);

test('画面にバンドルした依存の、ライセンスが添えてある', () => {
  const text = fs.readFileSync(path.join(skillDir, 'public', 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  for (const name of ['react', 'react-dom', 'mermaid', 'dompurify', 'marked', '@tanstack/query-core', 'zustand'])
    assert.match(text, new RegExp(`^### ${name} `, 'm'));
  assert.doesNotMatch(text, /ライセンス：（不明）/);
});

test('画面のライセンス：同じ名前の別の版も、版ごとに載る（marked が 2 つの版で入っている）', () => {
  const text = fs.readFileSync(path.join(skillDir, 'public', 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  const marked = [...text.matchAll(/^### marked (\S+)$/gm)].map((m) => m[1]);
  assert.ok(marked.length >= 2, `marked の版が 1 つしかない: ${marked.join(', ')}`);
  assert.equal(new Set(marked).size, marked.length);
});
