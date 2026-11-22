// 配布物（skills/rikai/ に、コミットしたバンドル）が、ソースから、いま作り直したものと同じであること（SPEC §8：成果物が古くなっていない）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { bundle, skillDir } from '../scripts/build';

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
