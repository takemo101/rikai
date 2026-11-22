// プラグイン（各エージェントへの配布）のマニフェストが、実際の配置と食い違わないこと。
// 各 CLI の検証コマンド（claude/grok/agy の plugin validate）は、自動テストに入れない（利用者の環境にある CLI に依存するため）。
// ここでは、それらで実際に起きた・起きうる食い違い（スキルの移動・名前・版・SKILL.md の frontmatter）だけを守る。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

// リポジトリのルート（app/test/server/ から 3 つ上）
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface MarketEntry {
  name: string;
  source: string | { source: string; path: string };
}
interface Market {
  plugins: MarketEntry[];
}
interface PluginJson {
  $schema?: string;
  name: string;
  version?: string;
  [key: string]: unknown;
}
interface PackageJson {
  name: string;
  version: string;
  keywords: string[];
  pi: { skills: string[] };
}

const readJSON = <T>(...p: string[]): T => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8')) as T;

// Agent Skills の frontmatter で許される項目。omp は、プラグインのスキルが、これ以外の項目（Claude 固有の
// argument-hint・disable-model-invocation など）を持つと、スキルごと読み込まない（2026-11-21 に実機で確認）
const SKILL_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
// Agent Plugins 1.0.0 の plugin.json の、最上位に置ける項目（additionalProperties: false）
const PLUGIN_KEYS = [
  '$schema',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'extensions',
];

function frontmatter(file: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file} に frontmatter がありません`);
  const fm: Record<string, string> = {};
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^["']?([A-Za-z][\w-]*)["']?\s*:\s*(.*)$/.exec(line); // 引用符つきのキーも、キーとして数える（omp は、それも項目として検査する）
    if (kv) fm[kv[1] as string] = kv[2] as string;
  }
  return fm;
}

test('スキルは skills/<名前>/SKILL.md にあり、名前がディレクトリ名と一致し、frontmatter が移植できる形', () => {
  const dir = path.join(root, 'skills', 'rikai');
  const fm = frontmatter(path.join(dir, 'SKILL.md'));
  assert.equal(fm.name, path.basename(dir), 'agy は、名前がディレクトリ名と違うと読み込まない');
  assert.doesNotMatch(
    fm.description || '',
    /^[>|][+-]?$/,
    'description が複数行（>・|）だと、このテストでは長さを測れない。1 行で書く',
  );
  assert.ok(fm.description && fm.description.length <= 1024, 'description は 1〜1024 文字');
  assert.deepEqual(
    Object.keys(fm).filter((k) => !SKILL_KEYS.includes(k)),
    [],
    'Agent Skills にない項目（omp が、スキルごと読み込まなくなる）',
  );
  // バンドルの rikai.js・その横の worker・画面（public）が、スキルと同じ場所にある
  for (const f of ['rikai.js', 'rikai-htmlapp-worker.js', 'THIRD-PARTY-LICENSES.txt', 'public'])
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} が、スキルと同じ場所にない（SKILL.md の手順が動かない）`);
});

test('ルートの plugin.json（Agent Plugins：codex・omp・agy）は、schema の形で、package.json と名前・版が同じ', () => {
  const plugin = readJSON<PluginJson>('plugin.json');
  const pkg = readJSON<PackageJson>('package.json');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual(
    Object.keys(plugin).filter((k) => !PLUGIN_KEYS.includes(k)),
    [],
    'schema にない項目（検証が失敗する）',
  );
  assert.match(plugin.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.equal(plugin.name, pkg.name);
  assert.equal(plugin.version, pkg.version, 'agy・codex が見る版と、package.json の版が食い違う');
});

test('Claude Code・grok のマニフェストとカタログは、同じ名前で、プラグインのルートを指す', () => {
  const plugin = readJSON<PluginJson>('plugin.json');
  const claude = readJSON<PluginJson>('.claude-plugin', 'plugin.json');
  const market = readJSON<Market>('.claude-plugin', 'marketplace.json');
  assert.equal(claude.name, plugin.name);
  assert.equal(
    claude.version,
    undefined,
    'Claude Code は、版を書くと、版を上げるまで更新しない（git の最新を使うため、書かない）',
  );
  const entry = market.plugins.find((x) => x.name === plugin.name);
  assert.ok(entry, 'カタログに、プラグインの項目がない');
  assert.equal(
    path.resolve(root, entry.source as string),
    root,
    '相対パスは、カタログのルート（リポジトリのルート）から',
  );
});

test('codex のカタログは、プラグインのルート（plugin.json がある場所）を指す', () => {
  const plugin = readJSON<PluginJson>('plugin.json');
  const market = readJSON<Market>('.agents', 'plugins', 'marketplace.json');
  const entry = market.plugins.find((x) => x.name === plugin.name);
  assert.ok(entry);
  const source = entry.source as { source: string; path: string };
  assert.equal(source.source, 'local');
  assert.match(source.path, /^\.\//, 'codex は、./ で始まる相対パスだけ');
  assert.ok(fs.existsSync(path.join(root, source.path, 'plugin.json')));
});

test('pi のパッケージ（package.json の pi）は、スキルのディレクトリを指す', () => {
  const pkg = readJSON<PackageJson>('package.json');
  assert.ok(pkg.keywords.includes('pi-package'));
  for (const rel of pkg.pi.skills) {
    const dir = path.join(root, rel);
    assert.ok(fs.statSync(dir).isDirectory(), `${rel} がない`);
    assert.ok(fs.existsSync(path.join(dir, 'rikai', 'SKILL.md')), `${rel} の下に、<名前>/SKILL.md がない`);
  }
});
