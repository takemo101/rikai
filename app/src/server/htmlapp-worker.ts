// html-app の取り出しを、別のスレッド（worker）で行う入口。htmlapp.ts の `appsOfAsync` が起こす。
// 資料は、AI が書いた、非信頼のデータ。marked の字句解析は、入力によっては、とても遅い・深い入れ子で例外になるので、
// サーバーのイベントループを止めないよう、ここ（別のスレッド）で解析し、親が時間を切る。
import { parentPort, workerData } from 'node:worker_threads';
import { appsOf } from './htmlapp-core';

if (parentPort && workerData && typeof workerData.markdown === 'string') {
  try {
    parentPort.postMessage({ ok: true, apps: appsOf(workerData.markdown) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e as Error | null)?.name) });
  }
}
