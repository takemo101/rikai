// 描く前に、保存した外観（rikai-ui の theme）を、<html data-theme> に付ける：ちらつき（FOUC）を避ける。
// 画面の本体（モジュールのスクリプト）は、遅れて動くので、CSS が効く前に、この小さな普通のスクリプトが、先に走る（CSP：script-src 'self' で許される外部ファイル）。
// 規則は、src/web/lib/theme.ts の parseTheme と同じ：'light'・'dark' だけ付ける。system（未保存・壊れた値・知らない値）は、付けない（OS に従う）。
try {
  var t = JSON.parse(localStorage.getItem('rikai-ui') || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
