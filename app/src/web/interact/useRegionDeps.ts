// 範囲の画像を作る部品（`RegionDeps`）：画像の保存（トピックを変えない操作）。イベントの処理が、いつも、最新の `attach` を呼ぶ。本文の範囲選択（Interact）と、個別表示（F43）が使う。
import { useEffect, useMemo, useRef } from 'react';
import { useMutations } from '../api/mutations';
import type { RegionDeps } from './region';

export function useRegionDeps(): RegionDeps {
  const { attach } = useMutations();
  const attachRef = useRef(attach);
  useEffect(() => {
    attachRef.current = attach;
  }, [attach]);
  return useMemo<RegionDeps>(() => ({ attach: (topic, data) => attachRef.current({ topic, data }) }), []);
}
