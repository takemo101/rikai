'use strict';
// プラグイン（各エージェントへの配布）のマニフェストが、実際の配置と食い違わないこと。
// 各 CLI の検証コマンド（claude/grok/agy の plugin validate）は、自動テストに入れない（利用者の環境にある CLI に依存するため）。
// ここでは、それらで実際に起きた・起きうる食い違い（スキルの移動・名前・版・SKILL.md の frontmatter）だけを守る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readJSON = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));

// Agent Skills の frontmatter で許される項目。omp は、プラグインのスキルが、これ以外の項目（Claude 固有の
// argument-hint・disable-model-invocation など）を持つと、スキルごと読み込まない（2026-11-21 に実機で確認）
const SKILL_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
// Agent Plugins 1.0.0 の plugin.json の、最上位に置ける項目（additionalProperties: false）
const PLUGIN_KEYS = ['$schema', 'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];

function frontmatter(file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, 'utf8'));
  assert.ok(m, `${file} に frontmatter がありません`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}

test('スキルは skills/<名前>/SKILL.md にあり、名前がディレクトリ名と一致し、frontmatter が移植できる形', () => {
  const dir = path.join(root, 'skills', 'rikai');
  const fm = frontmatter(path.join(dir, 'SKILL.md'));
  assert.equal(fm.name, path.basename(dir), 'agy は、名前がディレクトリ名と違うと読み込まない');
  assert.ok(fm.description && fm.description.length <= 1024, 'description は 1〜1024 文字');
  assert.deepEqual(Object.keys(fm).filter((k) => !SKILL_KEYS.includes(k)), [], 'Agent Skills にない項目（omp が、スキルごと読み込まなくなる）');
  for (const f of ['rikai.js', 'lib', 'public']) assert.ok(fs.existsSync(path.join(dir, f)), `${f} が、スキルと同じ場所にない（SKILL.md の手順が動かない）`);
});

test('ルートの plugin.json（Agent Plugins：codex・omp・agy）は、schema の形で、package.json と名前・版が同じ', () => {
  const plugin = readJSON('plugin.json');
  const pkg = readJSON('package.json');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.deepEqual(Object.keys(plugin).filter((k) => !PLUGIN_KEYS.includes(k)), [], 'schema にない項目（検証が失敗する）');
  assert.match(plugin.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.equal(plugin.name, pkg.name);
  assert.equal(plugin.version, pkg.version, 'agy・codex が見る版と、package.json の版が食い違う');
});

test('Claude Code・grok のマニフェストとカタログは、同じ名前で、プラグインのルートを指す', () => {
  const plugin = readJSON('plugin.json');
  const claude = readJSON('.claude-plugin', 'plugin.json');
  const market = readJSON('.claude-plugin', 'marketplace.json');
  assert.equal(claude.name, plugin.name);
  assert.equal(claude.version, undefined, 'Claude Code は、版を書くと、版を上げるまで更新しない（git の最新を使うため、書かない）');
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry, 'カタログに、プラグインの項目がない');
  assert.equal(path.resolve(root, entry.source), root, '相対パスは、カタログのルート（リポジトリのルート）から');
});

test('codex のカタログは、プラグインのルート（plugin.json がある場所）を指す', () => {
  const plugin = readJSON('plugin.json');
  const market = readJSON('.agents', 'plugins', 'marketplace.json');
  const entry = market.plugins.find((p) => p.name === plugin.name);
  assert.ok(entry);
  assert.equal(entry.source.source, 'local');
  assert.match(entry.source.path, /^\.\//, 'codex は、./ で始まる相対パスだけ');
  assert.ok(fs.existsSync(path.join(root, entry.source.path, 'plugin.json')));
});

test('pi のパッケージ（package.json の pi）は、スキルのディレクトリを指す', () => {
  const pkg = readJSON('package.json');
  assert.ok(pkg.keywords.includes('pi-package'));
  for (const rel of pkg.pi.skills) {
    const dir = path.join(root, rel);
    assert.ok(fs.statSync(dir).isDirectory(), `${rel} がない`);
    assert.ok(fs.existsSync(path.join(dir, 'rikai', 'SKILL.md')), `${rel} の下に、<名前>/SKILL.md がない`);
  }
});
