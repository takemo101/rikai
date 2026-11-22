// @vitest-environment jsdom
// 前の版との差分：変更したブロックの直後に、文字の差分の箱（.diffbox）。追加は .added。なくなったブロックは、最後にまとめる。
import { expect, test } from 'vitest';
import { blockEls, markBlocks } from '../../../src/web/doc/render/blocks';
import { addDiff } from '../../../src/web/doc/render/diff';
import { mdToFragment } from '../../../src/web/doc/render/markdown';

function diffOf(prev: string, cur: string, key = 'demo/root/2') {
  const frag = mdToFragment(cur, { slug: 'demo', kind: 'doc' });
  markBlocks(frag);
  const sum = addDiff(frag, { key, slug: 'demo', md: cur, prevMd: prev });
  const box = document.createElement('div');
  box.append(frag);
  return { sum, box };
}

test('変更・追加・削除の件数と、箱の位置（変更したブロックの直後）。差分の箱は、ブロックにならない', () => {
  const prev = '# 題\n\nこの段落は、変更される。内容は十分に長い。\n\n消える段落。\n\n同じ段落。\n';
  const cur = '# 題\n\nこの段落は、変更された。内容は十分に長い。\n\n同じ段落。\n\n新しい段落。\n';
  const { sum, box } = diffOf(prev, cur);
  expect(sum).toEqual({ changed: 1, added: 1, removed: 1 });
  const kids = [...box.children].map((e) => `${e.tagName}${e.className ? `.${e.className.replace(/ /g, '.')}` : ''}`);
  expect(kids).toEqual([
    'H1.blk',
    'P.blk.changed',
    'DETAILS.diffbox',
    'P.blk',
    'P.blk.changed.added',
    'DETAILS.diffbox.removed',
  ]);
  const changed = box.querySelector('.diffbox:not(.removed)');
  expect(changed?.querySelector('summary')?.textContent).toBe('前の版との差分');
  expect(changed?.querySelector('del')?.textContent).toBe('る');
  expect(changed?.querySelector('ins')?.textContent).toBe('た');
  expect(box.querySelector('.removed summary')?.textContent).toBe('前の版からなくなったブロック (1)');
  expect(box.querySelector('.removed del')?.textContent).toBe('消える段落。');
  expect(blockEls(box).some((e) => e.classList.contains('diffbox'))).toBe(false);
});

test('同じ内容なら、箱を足さない（件数 0）', () => {
  const md = '# 題\n\n段落。\n';
  const { sum, box } = diffOf(md, md, 'demo/root/3');
  expect(sum).toEqual({ changed: 0, added: 0, removed: 0 });
  expect(box.querySelector('.diffbox, .changed')).toBeNull();
});

test('リストの項目の変更：li の箱（li.diffbox）。ul の中に入る', () => {
  const { sum, box } = diffOf(
    '- 一つ目の項目を、書いた\n- 二つ目\n',
    '- 一つ目の項目を、直した\n- 二つ目\n',
    'demo/root/4',
  );
  expect(sum.changed).toBe(1);
  const li = box.querySelector('ul > li.diffbox');
  expect(li?.querySelector('details > summary')?.textContent).toBe('前の版との差分');
});

test('実行できる枠は、ソースで比べる（枠を足す・消しても、別の枠が、変更にならない）', () => {
  const app = (src: string) => `\`\`\`html-app\n${src}\n\`\`\`\n`;
  const prev = `${app('<p>A</p>')}\n${app('<p>B</p>')}\n`;
  const cur = `${app('<p>B</p>')}\n`;
  const { sum } = diffOf(prev, cur, 'demo/root/5');
  expect(sum).toEqual({ changed: 0, added: 0, removed: 1 });
});

test('表・図は、文字（セルを「 | 」でつなぐ・図はソース）で比べる。文字のないブロックが消えたら、ラベルで見せる', () => {
  const prev = '| a | b |\n|---|---|\n| 1 | 2 |\n\n![図の説明](assets/x.png)\n\n同じ。\n';
  const cur = '| a | b |\n|---|---|\n| 1 | 3 |\n\n同じ。\n';
  const { sum, box } = diffOf(prev, cur, 'demo/root/6');
  expect(sum).toEqual({ changed: 1, added: 0, removed: 1 });
  expect(box.querySelector('.removed del')?.textContent).toBe('画像: 図の説明');
});

test('差分の計画は、同じ版（key）でも、中身（Markdown）が違えば、作り直す（ページを切り替えながら読み込む途中の、競合）', () => {
  const a = diffOf('# 題\n\n古い段落。\n', '# 題\n\n古い段落。\n', 'demo/root/9');
  expect(a.sum).toEqual({ changed: 0, added: 0, removed: 0 });
  const b = diffOf('# 題\n\n古い段落。\n', '# 題\n\n古い段落。\n\n足した。\n', 'demo/root/9');
  expect(b.sum).toEqual({ changed: 0, added: 1, removed: 0 });
  const c = diffOf('# 題\n', '# 題\n\n足した。\n', 'demo/root/9');
  expect(c.sum.added).toBe(1);
  // 前の版が違えば、同じ key でも、別の結果（取り違えない）
  expect(diffOf('# 題\n\n別の前。\n', '# 題\n\n足した。\n', 'demo/root/9').sum).toEqual({
    changed: 0,
    added: 1,
    removed: 1,
  });
});

test('本文の直下の <svg>：変更・追加を、ブロックとして数える。差分の箱は、svg の後ろに入る', () => {
  const svg = (t: string) => `<svg width="200" height="80">\n<text x="10" y="40">${t}</text>\n</svg>`;
  const { sum, box } = diffOf(
    `# 題\n\n${svg('古い図の説明文です')}\n`,
    `# 題\n\n${svg('新しい図の説明文です')}\n\n${svg('追加の図')}\n`,
    'demo/root/11',
  );
  expect(sum).toEqual({ changed: 1, added: 1, removed: 0 });
  const kids = [...box.children].map((e) => e.tagName.toLowerCase());
  expect(kids).toEqual(['h1', 'svg', 'details', 'svg']);
  expect(box.querySelectorAll('svg.blk.changed')).toHaveLength(2);
  expect(box.querySelector('svg.added')?.textContent?.trim()).toBe('追加の図');
});
