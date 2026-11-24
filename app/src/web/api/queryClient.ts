// TanStack Query の共有のクライアント（画面に 1 つ）。
// 既定：失敗しても、勝手に再試行しない（1.5 秒ごとの取得か、サーバーからの通知〔events.ts〕が、その役）・裏のタブでも取得を続ける・
// 接続できないときも、取得を試す（networkMode）・窓に戻っただけでは、取り直さない。
import { QueryClient } from '@tanstack/react-query';

/** 一覧・トピックの取得の間隔。サーバーからの通知（SSE）がつながっている間は止め、切れている間の保険にする */
export const POLL_MS = 1500;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: true,
        networkMode: 'always',
      },
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}

export const queryClient = createQueryClient();
