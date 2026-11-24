// サーバーとの接続の状態（offline・error）。取得の失敗から、導く。
// 接続できない（fetch の失敗。status がない）と、サーバーが答えたエラー（status がある）は、別の状態として見せる。
import { ApiError } from '../api/client';

export interface ServerStatus {
  offline: boolean;
  error: string | null;
}

/** 取得の失敗（なければ null）の一覧から。最初の失敗を見る。すべて成功していれば、通常 */
export function serverStatus(errors: readonly unknown[]): ServerStatus {
  const e = errors.find((x) => x != null);
  if (e == null) return { offline: false, error: null };
  if (e instanceof ApiError && e.status) return { offline: false, error: e.message };
  return { offline: true, error: null };
}
