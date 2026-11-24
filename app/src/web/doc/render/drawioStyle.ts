// draw.io（mxGraph）のスタイル文字列（`key=value;key=value`）の読み取りと、色・数の検査。DOM に触れない純粋な関数。
// **スタイルは、資料の XML が持つ非信頼の値**：SVG の属性へ入れる前に、ここで検査する（色は `#rgb`/`#rrggbb`/`#rrggbbaa`/`none`/CSS の色名/`light-dark(a,b)` だけ。
// `url(…)`・`var(…)`・`rgb(…)`・任意の文字列は、色として受けない：属性・スタイルへの注入を防ぐ）。数は、有限の数で、範囲に収める。CSS の文字列は、組み立てない。

/** CSS の色名（148 個）→ 16 進（コントラストの計算に使う。名前そのものを、属性に使ってよい：この表にある語だけ） */
const NAMED_TABLE =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

const NAMED = new Map<string, string>(
  NAMED_TABLE.split(',').map((kv) => {
    const [k = '', v = ''] = kv.split(':');
    return [k, `#${v}`];
  }),
);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const LIGHT_DARK = /^light-dark\(\s*([^,()]{1,30}?)\s*,\s*([^,()]{1,30}?)\s*\)$/i;

/** 値の長さの上限（これを超える値は、無いものとして扱う） */
const VALUE_MAX = 400;
/** スタイル文字列の長さの上限 */
const STYLE_MAX = 4000;

/** 色の検査の結果：色（`#…` か色名）・`none`・`inherit`（親から引き継ぐ）。使えない値・未指定は null */
export type ColorValue = string;

export interface Style {
  /** `;` で区切った、`=` のない語（`ellipse`・`swimlane`・`text` など。draw.io の基本のスタイル名）。小文字 */
  readonly bare: readonly string[];
  /** 文字列の値（未指定は undefined） */
  str(key: string): string | undefined;
  /** 数（有限でなければ def。min〜max に収める） */
  num(key: string, def: number, min?: number, max?: number): number;
  /** 0/1 の旗（未指定は def） */
  flag(key: string, def: boolean): boolean;
  /** 検査した色（未指定・使えない値は null）。`light-dark(a,b)` は、theme に合う側 */
  color(key: string, theme: 'light' | 'dark'): ColorValue | null;
  /** 使えない色の値があった（記録用） */
  readonly badColors: readonly string[];
}

/** 色を検査する。`none`・`inherit`・16 進・色名・`light-dark(a,b)`。それ以外・`default`・空は null */
export function checkColor(raw: string, theme: 'light' | 'dark'): ColorValue | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === 'default' || v === 'automatic') return null;
  if (v === 'none' || v === 'inherit') return v;
  if (HEX.test(v)) return v;
  if (NAMED.has(v)) return v;
  const m = LIGHT_DARK.exec(raw.trim());
  if (m) return checkColor(theme === 'dark' ? (m[2] ?? '') : (m[1] ?? ''), theme);
  return null;
}

/** スタイル文字列を読む（キーは、Map に持つ：`__proto__` などのキーが、オブジェクトを汚さない） */
export function parseStyle(src: string | null | undefined): Style {
  const kv = new Map<string, string>();
  const bare: string[] = [];
  const bad: string[] = [];
  for (const part of (src ?? '').slice(0, STYLE_MAX).split(';')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 0) bare.push(t.toLowerCase());
    else if (t.length - i - 1 <= VALUE_MAX) kv.set(t.slice(0, i).trim(), t.slice(i + 1).trim());
  }
  return {
    bare,
    badColors: bad,
    str: (key) => kv.get(key),
    num(key, def, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
      const raw = kv.get(key);
      if (raw === undefined || raw === '') return def;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
    },
    flag(key, def) {
      const raw = kv.get(key);
      return raw === undefined ? def : raw !== '0' && raw !== 'false' && raw !== '';
    },
    color(key, theme) {
      const raw = kv.get(key);
      if (raw === undefined) return null;
      const c = checkColor(raw, theme);
      if (c === null && raw.trim() && !/^(default|automatic)$/i.test(raw.trim()) && bad.length < 5) bad.push(key);
      return c;
    },
  };
}

/** 16 進の色（`#rgb`・`#rrggbb`・`#rrggbbaa`）か色名の、明るさ（0〜1：相対輝度）。読めなければ null */
export function luminanceOf(color: string): number | null {
  let hex = color.startsWith('#') ? color : (NAMED.get(color) ?? '');
  if (!hex) return null;
  hex = hex.slice(1);
  if (hex.length === 3 || hex.length === 4)
    hex = [...hex]
      .slice(0, 3)
      .map((c) => c + c)
      .join('');
  if (hex.length < 6) return null;
  const ch = [0, 2, 4].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

/** 地の色の上に置く、読める文字の色（黒か白）。地の色が読めなければ null */
export function inkOn(background: string): '#000000' | '#ffffff' | null {
  const l = luminanceOf(background);
  if (l === null) return null;
  return l > 0.179 ? '#000000' : '#ffffff';
}
