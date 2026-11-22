// サーバーとの通信（型は、サーバーの AppType から：Hono RPC）。
// 同じオリジンへ送る。合言葉は Cookie（HttpOnly）なので、画面は、何も付けない（N2）。
import { hc } from 'hono/client';
import type { AppType } from '../../server/app';

export const api = hc<AppType>('/');

/** サーバーが答えたエラー（status あり）。接続できないとき（fetch の失敗）は、status のない TypeError のまま */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * 応答を読む（旧 `api()` と同じ）。JSON でなければ「通信エラー」・`!res.ok` か `ok: false` なら、サーバーの error の文言で、ApiError。
 * T は、呼ぶ側が、hc の応答の型（成功のもの）で指定する。
 */
export async function read<T>(res: Response): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError('通信エラー', res.status);
  }
  const failed = !res.ok || (typeof body === 'object' && body !== null && 'ok' in body && body.ok === false);
  if (failed) {
    const msg = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
    throw new ApiError(typeof msg === 'string' && msg ? msg : 'エラー', res.status);
  }
  // 検査したのは、失敗の形だけ。成功の形は、サーバーの型（hc）に任せる境界
  const ok = body as T;
  return ok;
}
