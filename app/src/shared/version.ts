// rikai の版（`rikai --version`・画面の「v…」）。ビルドのときに、ルートの package.json の version で置き換わる
// （scripts/version.ts の `versionDefine`：esbuild・Vite・Vitest の `define`）。実行時にファイルは読まない。
declare const __RIKAI_VERSION__: string;

export const VERSION: string = __RIKAI_VERSION__;
