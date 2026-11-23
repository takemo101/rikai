// CLI の標準入力：大きな入力（パイプ・ヒアドキュメント相当）・ファイルからのリダイレクト・マルチバイト（チャンクの境目で割れない）・空の入力。
// `fs.readFileSync(0)` は、ノンブロッキングのパイプで、入力が途切れた瞬間に `EAGAIN` で失敗した（約 18 万バイト以上。SKILL.md が案内するヒアドキュメントでも）。
// パイプの書き手を、チャンクの間で待たせて（入力が途切れる瞬間を、必ず作る）、子プロセスに渡す。作り物の資料だけ。
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

const cli = (): string => process.env.RIKAI_CLI as string;
let root = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-stdin-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

interface Result {
  status: number | null;
  json: { ok?: boolean; errors?: string[] };
}

/** `chunks` を、間をあけて、標準入力（パイプ）へ書く。`stdio` を渡せば（ファイルなど）、書かない */
function run(args: string[], chunks: Buffer[], gapMs = 40, stdio?: 'file', file?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const fd = stdio === 'file' && file ? fs.openSync(file, 'r') : null;
    const child: ChildProcess = spawn(process.execPath, [cli(), ...args, '--root', root], {
      env: { ...process.env, NO_OPEN: '1' },
      stdio: [fd ?? 'pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      if (fd !== null) fs.closeSync(fd);
      let json: Result['json'] = {};
      try {
        json = JSON.parse(out);
      } catch {}
      resolve({ status, json });
    });
    if (fd !== null) return;
    void (async () => {
      for (const c of chunks) {
        child.stdin?.write(c);
        await new Promise((r) => setTimeout(r, gapMs));
      }
      child.stdin?.end();
    })();
  });
}

const split = (b: Buffer, size: number): Buffer[] => {
  const out: Buffer[] = [];
  for (let i = 0; i < b.length; i += size) out.push(b.subarray(i, i + size));
  return out;
};

/** 日本語・絵文字（4 バイト）を含む、指定のバイト数以上の資料 */
function doc(bytes: number): string {
  const para = '猫は一日に十六時間ほど眠ります。🐈 日向でよく丸くなります。👨‍👩‍👧\n\n';
  let s = '# 大きな資料\n\n';
  while (Buffer.byteLength(s) < bytes) s += para;
  return s;
}
const pageOf = (v: number): string =>
  fs.readFileSync(path.join(root, '.rikai', 'big', 'pages', 'root', `v${v}.md`), 'utf8');

for (const [label, bytes] of [
  ['約 250KB', 250_000],
  ['約 2MB', 2_000_000],
] as const) {
  test(`new：${label}の標準入力（パイプ）が、EAGAIN にならず、そのまま保存される`, { timeout: 30_000 }, async () => {
    const md = doc(bytes);
    const r = await run(['new', 'big', '--title', '大'], split(Buffer.from(md), 65_537), 10);
    expect(r.json.errors ?? []).toEqual([]);
    expect(r.status).toBe(0);
    expect(pageOf(1)).toBe(md);
  });

  test(`apply：${label}の JSON の標準入力（パイプ）が、EAGAIN にならず、新しい版になる`, {
    timeout: 30_000,
  }, async () => {
    await run(['new', 'big', '--title', '大'], [Buffer.from('# 小\n')]);
    const md = doc(bytes);
    const r = await run(
      ['apply', 'big'],
      split(Buffer.from(JSON.stringify({ revisions: [{ page: 'root', markdown: md }] })), 65_537),
      10,
    );
    expect(r.json.errors ?? []).toEqual([]);
    expect(r.status).toBe(0);
    expect(pageOf(2)).toBe(md);
  });
}

test('マルチバイト（日本語・絵文字）が、チャンクの境目で割れても、壊れない（1 バイトずつ・3 バイトずつ）', async () => {
  const md = '# 題\n\n猫🐈と犬🐕、👨‍👩‍👧 の家族。\n';
  for (const size of [1, 3]) {
    fs.rmSync(path.join(root, '.rikai'), { recursive: true, force: true });
    const r = await run(['new', 'big', '--title', '割れない'], split(Buffer.from(md), size), 2);
    expect(r.status).toBe(0);
    expect(pageOf(1)).toBe(md);
  }
});

test('ファイルからのリダイレクト（< file）も、読める', async () => {
  const md = doc(300_000);
  const f = path.join(root, 'in.md');
  fs.writeFileSync(f, md);
  const r = await run(['new', 'big', '--title', '大'], [], 0, 'file', f);
  expect(r.status).toBe(0);
  expect(pageOf(1)).toBe(md);
});

test('空の入力：new は「資料が空です」・apply は「JSON が不正です」で、失敗する（終了コード 1。固まらない）', async () => {
  const bad = await run(['apply', 'nothing'], []);
  expect(bad.status).toBe(1);
  expect(bad.json.errors?.[0]).toContain('JSON が不正です');
  const empty = await run(['new', 'big', '--title', '空'], []);
  expect(empty.status).toBe(1);
  expect(empty.json.errors?.[0]).toContain('資料(Markdown)が空です');
});
