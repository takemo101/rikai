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

// 本文の、範囲（左上にあるブロック〔画像・図があれば、その最初の画像・図〕の大きさに対する比率。左上が原点）。
// 範囲は、そのブロックの外へ出てよい（複数のブロックにまたがる）ので、左上は −1〜1・幅と高さは 100 まで。4 桁に丸める。数でない・小さすぎる（0.5% 未満）なら、範囲なし
function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const raw = [r.x, r.y, r.w, r.h].map(Number);
  if (!raw.every(Number.isFinite)) return null;
  const c = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v * 10000) / 10000));
  const w = c(raw[2], 0, 100), h = c(raw[3], 0, 100);
  return w < 0.005 || h < 0.005 ? null : { x: c(raw[0], -1, 1), y: c(raw[1], -1, 1), w, h };
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
