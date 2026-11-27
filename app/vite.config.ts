// 画面（React）のビルドと、開発サーバー。
// - root は src/web。出力は skills/rikai/public/（root からの相対。`emptyOutDir` で、旧 UI のファイルごと置き換える）。
//   **`vite build` を、そのまま実行すると、skills/rikai/public/ を空にして書き換える**。試すときは `--outDir /tmp/…` を付ける
// - dev：rikai のサーバー（`RIKAI_SERVER=http://127.0.0.1:<ポート>`）を、別に起こしておく。画面から出る /api・/asset・/appframe だけを、そこへ proxy する。
//   合言葉は Cookie（`rikai_t_<ポート>`）：先に、`http://127.0.0.1:<ポート>/?t=<合言葉>` を一度開き、そのあと `http://127.0.0.1:5173/` を開く
//   （Cookie は、ポートで分かれない。ホスト名は、127.0.0.1 にそろえる）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import { licensesPlugin } from './scripts/licenses-plugin';
import { versionDefine } from './scripts/version';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'web');

/** サーバーは、Host・Origin・Cookie を確かめる。Host は changeOrigin が、Origin は、ここで、サーバーのものに書き換える */
function proxyTo(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    // 画面のソース（src/web/api/queries.ts など）も、/api で始まる。ソースのファイルは、proxy せず、Vite が返す
    bypass: (req) => (/\.[cm]?[jt]sx?(\?|$)/.test(req.url ?? '') ? req.url : undefined),
    configure: (proxy) => {
      proxy.on('proxyReq', (req) => {
        if (req.getHeader('origin')) req.setHeader('origin', target);
      });
    },
  };
}

/**
 * 数式（KaTeX）の CSS の、フォントの指定を、woff2 だけにする（SPEC N1・N5）。`katex.min.css` の `@font-face` は、woff2・woff・ttf の 3 つを並べる（古いブラウザ用）。
 * そのままだと、Vite が、3 形式すべてを `assets/` に出す（約 1.2MB）。Chrome・Safari・Firefox の現行版は、woff2 を読めるので、woff・ttf は、出さない。
 * KaTeX の更新で、書式が変わって、除けなかったときは、ビルドを失敗させる（黙って、重いまま出さない）
 */
function katexWoff2Only(): Plugin {
  return {
    name: 'rikai-katex-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex\.min\.css(?:\?|$)/.test(id)) return null;
      const out = code.replace(
        /,url\(fonts\/[\w-]+\.woff\) format\("woff"\),url\(fonts\/[\w-]+\.ttf\) format\("truetype"\)/g,
        '',
      );
      if (/\.(?:woff|ttf)\b/.test(out.replace(/\.woff2\b/g, '')))
        throw new Error(
          'katex.min.css の @font-face から、woff・ttf を除けませんでした（vite.config.ts の katexWoff2Only を、KaTeX の書式に合わせる）',
        );
      return { code: out, map: null };
    },
  };
}

export default defineConfig(({ command }) => {
  const server = process.env.RIKAI_SERVER ?? '';
  if (command === 'serve' && !server)
    throw new Error('RIKAI_SERVER=http://127.0.0.1:<rikai のポート> を指定してください');
  return {
    root,
    base: '/',
    define: versionDefine, // 画面の「v…」：ビルドのときに、ルートの package.json の version を埋め込む（実行時に、ファイルや API で探さない）
    plugins: [react(), katexWoff2Only(), licensesPlugin()],
    build: {
      outDir: '../../../skills/rikai/public',
      emptyOutDir: true,
      // フォント（woff2）は、ファイルのまま出す（data: に埋め込まない：画面の CSP は、`font-src` を持たず、`default-src 'self'` が効く。data: のフォントは、読めない）
      assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
      chunkSizeWarningLimit: 2000, // Mermaid の図の種類ごとの chunk（elk は約 1.5MB）。必要になるまで、読まない（動的 import）
      // ファイル名に、内容のハッシュを付けない。サーバーは、全応答に `Cache-Control: no-store` を付ける（server/app.ts）ので、ハッシュはキャッシュ破りの役に立たず、
      // 付けると、1 行の変更で、chunk の名前が連鎖して変わり（import 先の名前が、中身に入る）、コミットする `public/` の差分・履歴が膨らむ（`index.js` だけが変わる）。
      // **SharedWorker（`api/eventsWorker.ts`）だけは、ハッシュつきのまま**（`worker` の出力名を設定しない）：SharedWorker は、同じオリジンで、同じ URL なら、開いている古いタブのものを共有する。
      // 名前に内容のハッシュがあれば、ワーカーの中身が変わった版では、URL が変わり、古いワーカーと新しい画面が、混ざらない（オリジンはポートごとで、サーバーの起動のたびに変わるが、同じポートが再び当たる可能性は、ゼロではない）。
      // ワーカーは、他のファイルを import せず、中身が変わらない限り、名前も変わらない（実測：`App.tsx` を変えても、同じ名前）ので、履歴は、膨らまない
      rolldownOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: server ? { '/api': proxyTo(server), '/asset': proxyTo(server), '/appframe': proxyTo(server) } : undefined,
    },
  };
});
