// 共通の小さな道具（エラー・時刻・JSON の読み書き・待つ・出力）。ほかのモジュールに依存しない。
import fs from 'node:fs';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function out(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
export const now = (): string => new Date().toISOString();

export function readJSON<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw e;
  }
}
export function writeJSON(p: string, v: unknown, mode?: number): void {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, p);
}

export const str = (v: unknown, max = 20000): string => String(v == null ? '' : v).slice(0, max);
