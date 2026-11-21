'use strict';
// 共通の小さな道具（エラー・時刻・JSON の読み書き・待つ・出力）。ほかのモジュールに依存しない。
const fs = require('fs');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function out(obj) { console.log(JSON.stringify(obj, null, 2)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
const now = () => new Date().toISOString();

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function writeJSON(p, v, mode) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, p);
}

const str = (v, max = 20000) => String(v == null ? '' : v).slice(0, max);

// 図・画像の中の範囲（その要素の大きさに対する比率。左上が原点）。0〜1 に収め、4 桁に丸める。数でない・小さすぎる（0.5% 未満）なら、範囲なし
function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const raw = [r.x, r.y, r.w, r.h].map(Number);
  if (!raw.every(Number.isFinite)) return null;
  const c = (v) => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
  const x = c(raw[0]), y = c(raw[1]);
  const w = Math.min(c(raw[2]), Math.round((1 - x) * 10000) / 10000), h = Math.min(c(raw[3]), Math.round((1 - y) * 10000) / 10000);
  return w < 0.005 || h < 0.005 ? null : { x, y, w, h };
}

function normAnchor(a) {
  if (!a || typeof a !== 'object') return null;
  const rect = normRect(a.rect);
  return {
    blockId: str(a.blockId, 40), blockHash: str(a.blockHash, 40), blockTag: str(a.blockTag, 16), blockText: str(a.blockText, 200),
    quote: str(a.quote, 2000), prefix: str(a.prefix, 64), suffix: str(a.suffix, 64), label: str(a.label, 120),
    ...(rect ? { rect } : {}),
  };
}

module.exports = { HttpError, out, sleep, sleepSync, now, readJSON, writeJSON, str, normAnchor, normRect };
