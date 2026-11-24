// draw.io の図の描画の本体（XML → モデル → SVG）。**動的 import で読む**（図のない資料では、読まない：`drawio.ts`）。
// 圧縮された `<diagram>` は、`DecompressionStream` で展開する（できなければ、`DrawioError`）。失敗は、すべて `DrawioError`（理由つき）：成功に見せない。
import { buildModel, DrawioError, inflateDiagram, LIMITS, pageOf } from './drawioModel';
import { buildSvg, type DrawioSvg, FONT } from './drawioSvg';
import { canvasMeasure, type Measure } from './drawioText';

let measure: Measure | null = null;

export async function renderDrawio(source: string, theme: 'light' | 'dark'): Promise<DrawioSvg> {
  const xml = source.trim();
  if (!xml) throw new DrawioError('図の XML が空です');
  if (xml.length > LIMITS.xml) throw new DrawioError(`XML が大きすぎます（上限 ${LIMITS.xml / 1000}KB）`);
  let page = pageOf(xml);
  const pages = page.pages;
  if (!page.model && page.compressed) page = pageOf(await inflateDiagram(page.compressed));
  if (!page.model) throw new DrawioError('圧縮された図を展開できません');
  const model = buildModel(page.model, pages);
  if (!model.items.length) throw new DrawioError('描く図形がありません（セルがありません）');
  measure ??= canvasMeasure(FONT);
  const out = buildSvg(model, { theme, measure });
  return out;
}
