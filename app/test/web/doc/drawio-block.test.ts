// @vitest-environment jsdom
// ```drawio の図のブロック：Mermaid の図と同じ経路（置き場・番号・ラベル・アンカー・文字の数え方・差分・描画・失敗の表示・外観）
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { fillDiagrams } from '../../../src/web/doc/render';
import {
  blockAnchor,
  blockEls,
  blockLabel,
  blockText,
  markBlocks,
  plainText,
  textIndex,
} from '../../../src/web/doc/render/blocks';
import { addDiff } from '../../../src/web/doc/render/diff';
import { mdToFragment } from '../../../src/web/doc/render/markdown';
import { markFocusEntries } from '../../../src/web/focus/focusable';
import { anchorFromSelection } from '../../../src/web/interact/selection';
import { applyTheme } from '../../../src/web/lib/theme';
import { resetAll } from '../helpers';

const BT = '```';
const XML = (label: string, extra = '') =>
  `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="${label}" style="rounded=1;html=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="100" height="40" as="geometry"/></mxCell>${extra}</root></mxGraphModel>`;
const md = (xml: string, tail = '') => `# 題\n\n前の段落。\n\n${BT}drawio\n${xml}\n${BT}\n\n後の段落。\n${tail}`;
const frag = (text: string, kind: 'doc' | 'reply' = 'doc') => {
  const f = mdToFragment(text, { slug: 'demo', kind });
  const box = document.createElement('div');
  box.append(f);
  document.body.append(box);
  return box;
};

beforeEach(() => {
  resetAll();
  // jsdom には canvas がない：文字幅は、近似で測る
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  applyTheme('light');
  document.body.replaceChildren();
});

test('置き場：```drawio → .drawio-block（XML は、URI エンコードして data-drawio）。返信でも同じ。本文のブロックの番号・種類は、Mermaid と同じ', () => {
  const box = frag(md(XML('猫')));
  const blk = box.querySelector<HTMLElement>('.drawio-block');
  expect(blk).not.toBeNull();
  expect(decodeURIComponent(blk?.dataset.drawio ?? '')).toBe(XML('猫'));
  expect(frag(md(XML('猫')), 'reply').querySelector('.drawio-block')).not.toBeNull();
  markBlocks(box);
  expect(blockEls(box).map((b) => b.dataset.bid)).toEqual(['b0', 'b1', 'b2', 'b3']);
  expect(blockEls(box)[2]?.classList.contains('drawio-block')).toBe(true);
});

test('資料の生の HTML に書かれた <script>・onload は、無害化で消え、```drawio の中の <script> は、ただの文字（XML の一部）', () => {
  const box = frag(
    `<div class="drawio-block" data-drawio="x" onclick="alert(1)"><script>alert(1)</script></div>\n\n${BT}drawio\n<script>alert(1)</script>\n${BT}\n`,
  );
  expect(box.querySelector('script')).toBeNull();
  expect(box.querySelectorAll('[onclick]')).toHaveLength(0);
});

test('ラベル・アンカー・ハッシュ：図は「図」。アンカーの文字は、ソース（URI エンコードのまま）。ソースが変われば、ハッシュが変わる', () => {
  const box = frag(md(XML('猫')));
  markBlocks(box);
  const blk = box.querySelector<HTMLElement>('.drawio-block') as HTMLElement;
  expect(blockLabel(blk)).toBe('図');
  expect(blockText(blk)).toBe(blk.dataset.drawio);
  const a = blockAnchor(blk);
  expect(a).toMatchObject({ blockId: 'b2', blockTag: 'DIV', label: '図', quote: '' });
  expect(a.blockText).toBe(blk.dataset.drawio?.slice(0, a.blockText.length));
  const other = frag(md(XML('犬')));
  markBlocks(other);
  expect((other.querySelector('.drawio-block') as HTMLElement).dataset.bhash).not.toBe(blk.dataset.bhash);
  expect(plainText(blk)).toBe(XML('猫')); // 差分に使う文字は、デコードしたソース
});

test('描画：SVG が入る（HTML の文字列を使わない）・textIndex（コメントの位置づけ）に、図の中の文字は入らない・入口（フォーカスできる）はブロック', async () => {
  const box = frag(md(XML('猫のラベル')));
  markBlocks(box);
  await fillDiagrams(box);
  const blk = box.querySelector<HTMLElement>('.drawio-block') as HTMLElement;
  expect(blk.querySelector('svg')?.getAttribute('role')).toBe('img');
  expect(blk.querySelector('svg text')?.textContent).toBe('猫のラベル');
  expect(textIndex(box).text).not.toContain('猫のラベル');
  expect(textIndex(box).text).toContain('前の段落');
  markFocusEntries(box);
  expect(blk.getAttribute('tabindex')).toBe('0');
  expect(blk.getAttribute('role')).toBe('button');
  expect(blk.querySelector('svg')?.hasAttribute('tabindex')).toBe(false);
});

test('図の中の文字を選んだ選択は、その図のブロックのアンカー（Mermaid と同じ）', async () => {
  const box = frag(md(XML('猫のラベル')));
  markBlocks(box);
  await fillDiagrams(box);
  const text = box.querySelector('.drawio-block svg text') as Element;
  const sel = getSelection() as Selection;
  const range = document.createRange();
  range.selectNodeContents(text);
  sel.removeAllRanges();
  sel.addRange(range);
  const anchor = anchorFromSelection(box, sel);
  expect(anchor?.blockId).toBe('b2');
  expect(anchor?.label).toBe('図');
});

test('差分（F11）：図のソースが変われば「変更」・同じなら「変更なし」。Mermaid の図と同じ基準', () => {
  const diffOf = (prev: string, cur: string) => {
    const f = mdToFragment(cur, { slug: 'demo', kind: 'doc' });
    markBlocks(f);
    const sum = addDiff(f, { key: `d/${prev.length}/${cur.length}`, slug: 'demo', md: cur, prevMd: prev });
    const box = document.createElement('div');
    box.append(f);
    return { sum, box };
  };
  const a = md(XML('猫'));
  expect(diffOf(a, a).sum).toEqual({ changed: 0, added: 0, removed: 0 });
  const { sum, box } = diffOf(a, md(XML('犬')));
  expect(sum.changed).toBe(1);
  expect(box.querySelector('.drawio-block.changed')).not.toBeNull();
  expect(box.querySelector('.diffbox ins, .diffbox del')).not.toBeNull(); // XML の文字の差分
});

test('失敗：壊れた XML・上限超え・対応しない形は、Mermaid と同じ表示（.mermaid-error・.mm-err・pre）。ソースは、文字として。成功に見せない', async () => {
  const bad = [
    '<mxGraphModel><root>',
    `<script>alert(1)</script>`,
    XML('x', Array.from({ length: 2100 }, (_, i) => `<mxCell id="n${i}" vertex="1" parent="1"/>`).join('')),
  ];
  const box = frag(bad.map((b) => `${BT}drawio\n${b}\n${BT}\n`).join('\n'));
  await fillDiagrams(box);
  const blocks = [...box.querySelectorAll<HTMLElement>('.drawio-block')];
  expect(blocks).toHaveLength(3);
  for (const b of blocks) {
    expect(b).toHaveClass('mermaid-error');
    expect(b.querySelector('svg')).toBeNull();
    expect(b.querySelector('.mm-err')?.textContent).toMatch(/^図を描画できませんでした（draw\.io）：/);
  }
  expect(blocks[0]?.querySelector('.mm-err')?.textContent).toContain('読めません');
  expect(blocks[2]?.querySelector('.mm-err')?.textContent).toContain('セルが多すぎ');
  expect(blocks[1]?.querySelector('pre')?.textContent).toBe('<script>alert(1)</script>');
  expect(box.querySelector('script')).toBeNull();
});

test('未対応の図形は、四角で描き、図の下に記録を出す（文字として）', async () => {
  const box = frag(
    md(
      XML(
        'a',
        `<mxCell id="o" vertex="1" style="shape=mxgraph.bpmn.gateway2" parent="1"><mxGeometry x="200" y="0" width="40" height="40" as="geometry"/></mxCell>`,
      ),
    ),
  );
  await fillDiagrams(box);
  expect(box.querySelector('.drawio-block svg')).not.toBeNull();
  expect(box.querySelector('.drawio-block .dx-note')?.textContent).toContain('mxgraph.bpmn.gateway2');
});

test('外観：ダークで描き直すと、既定の色のリテラル（フォールバック）がダークになる。同じ外観・同じソースは、使い回す（組み直さない）', async () => {
  const box = frag(md(XML('猫')));
  const blk = box.querySelector('.drawio-block') as HTMLElement;
  await fillDiagrams(box);
  expect(blk.innerHTML).toContain('var(--dx-ink, #000000)');
  const first = blk.querySelector('svg');
  await fillDiagrams(box);
  expect(blk.querySelector('svg')).not.toBe(first); // 複製を置く（置き換え）
  expect(blk.innerHTML).toBe(first ? first.outerHTML : ''); // 中身は、同じ
  applyTheme('dark');
  await fillDiagrams(box);
  await waitFor(() => expect(blk.innerHTML).toContain('var(--dx-ink, #e4e4e7)'));
});

test('描いている間に、ブロックが差し替わったら、古い図は置かない', async () => {
  const box = frag(md(XML('古い')));
  const blk = box.querySelector('.drawio-block') as HTMLElement;
  const job = fillDiagrams(box);
  blk.dataset.drawio = encodeURIComponent(XML('新しい'));
  await job;
  expect(blk.querySelector('svg')).toBeNull();
});
