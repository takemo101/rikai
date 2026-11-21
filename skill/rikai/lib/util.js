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

function normAnchor(a) {
  if (!a || typeof a !== 'object') return null;
  return {
    blockId: str(a.blockId, 40), blockHash: str(a.blockHash, 40), blockTag: str(a.blockTag, 16), blockText: str(a.blockText, 200),
    quote: str(a.quote, 2000), prefix: str(a.prefix, 64), suffix: str(a.suffix, 64), label: str(a.label, 120),
  };
}

module.exports = { HttpError, out, sleep, sleepSync, now, readJSON, writeJSON, str, normAnchor };
