// ハッシュのルーティング：`#/<slug>/<page>/v<n>`（page・版は省略できる）。旧 app.js の parseHash と同じ正規表現。
// 注意（旧と同じ）：`#/<slug>/v2` の `v2` は、ページの名前として読まれる（版の指定は、`#/<slug>/<page>/v2`）
import { useMemo, useSyncExternalStore } from 'react';

export interface Route {
  slug: string;
  page: string;
  /** 明示された版。省略は null（最新版） */
  version: number | null;
}

const HASH = /^#\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?(?:\/v(\d+))?$/;

export function parseHash(hash: string): Route | null {
  const m = HASH.exec(hash);
  return m ? { slug: m[1] as string, page: m[2] ?? 'root', version: m[3] ? Number(m[3]) : null } : null;
}

/** リンクの href。page を省略すると、root。version が null なら、版は付けない */
export function hrefOf(slug: string, page = 'root', version: number | null = null): string {
  return `#/${slug}/${page}${version ? `/v${version}` : ''}`;
}

export function navigate(slug: string, page = 'root', version: number | null = null): void {
  location.hash = hrefOf(slug, page, version);
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const snapshot = (): string => location.hash;

/** いまの URL のハッシュを、読んだもの（読めなければ null）。hashchange で更新される */
export function useRoute(): Route | null {
  const hash = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => parseHash(hash), [hash]);
}
