// 画面（React）のビルドと、開発サーバー。
// - root は src/web。出力は skills/rikai/public/（root からの相対。`emptyOutDir` で、旧 UI のファイルごと置き換える）。
//   **`vite build` を、そのまま実行すると、skills/rikai/public/ を空にして書き換える**。試すときは `--outDir /tmp/…` を付ける
// - dev：rikai のサーバー（`RIKAI_SERVER=http://127.0.0.1:<ポート>`）を、別に起こしておく。画面から出る /api・/asset・/appframe だけを、そこへ proxy する。
//   合言葉は Cookie（`rikai_t_<ポート>`）：先に、`http://127.0.0.1:<ポート>/?t=<合言葉>` を一度開き、そのあと `http://127.0.0.1:5173/` を開く
//   （Cookie は、ポートで分かれない。ホスト名は、127.0.0.1 にそろえる）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';
import { licensesPlugin } from './scripts/licenses-plugin';

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

export default defineConfig(({ command }) => {
  const server = process.env.RIKAI_SERVER ?? '';
  if (command === 'serve' && !server)
    throw new Error('RIKAI_SERVER=http://127.0.0.1:<rikai のポート> を指定してください');
  return {
    root,
    base: '/',
    plugins: [react(), tailwindcss(), licensesPlugin()],
    build: {
      outDir: '../../../skills/rikai/public',
      emptyOutDir: true,
      chunkSizeWarningLimit: 2000, // Mermaid の図の種類ごとの chunk（elk は約 1.5MB）。必要になるまで、読まない（動的 import）
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: server ? { '/api': proxyTo(server), '/asset': proxyTo(server), '/appframe': proxyTo(server) } : undefined,
    },
  };
});
