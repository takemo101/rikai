// 図（Mermaid・draw.io）と数式（KaTeX）を、まとめて描く：本文・返信・比べる画面・外観の変更が、同じ入口を使う。
import { fillDrawio } from './drawio';
import { fillMath } from './math';
import { fillMermaid } from './mermaid';

export async function fillDiagrams(container: ParentNode): Promise<void> {
  await Promise.all([fillMermaid(container), fillDrawio(container), fillMath(container)]);
}
