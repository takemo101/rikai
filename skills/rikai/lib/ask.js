'use strict';
// ask（AI から人への質問）の検証：AI が出す質問の形（normAsk）と、人の回答の形（normAnswer）。
const { HttpError } = require('./util.js');

const ASK_TYPES = ['single_choice', 'multi_choice', 'yes_no', 'scale', 'free_text'];

function normAsk(ask, where, errs) {
  if (ask == null) return null;
  if (typeof ask !== 'object' || !ASK_TYPES.includes(ask.type)) {
    errs.push(`${where}.ask.type は ${ASK_TYPES.join(' / ')} のどれか`);
    return null;
  }
  const out = { type: ask.type, question: String(ask.question || '').trim() };
  if (!out.question) errs.push(`${where}.ask.question が空です`);
  if (ask.type === 'single_choice' || ask.type === 'multi_choice') {
    const opts = Array.isArray(ask.options) ? ask.options : [];
    if (opts.length < 2 || opts.length > 8) errs.push(`${where}.ask.options は2〜8個`);
    const ids = new Set();
    out.options = [];
    for (const o of opts) {
      const id = String(o && o.id || '').trim();
      const label = String(o && o.label || '').trim();
      if (!id || !label) { errs.push(`${where}.ask.options の id と label は必須`); continue; }
      if (ids.has(id)) errs.push(`${where}.ask.options の id が重複: ${id}`);
      ids.add(id);
      out.options.push({ id, label, ...(o.detail ? { detail: String(o.detail) } : {}) });
    }
    out.allowOther = !!ask.allowOther;
  } else if (ask.type === 'scale') {
    const min = ask.min == null ? 1 : ask.min;
    const max = ask.max == null ? 5 : ask.max;
    if (!Number.isInteger(min) || !Number.isInteger(max) || max <= min || max - min > 9) errs.push(`${where}.ask の min/max は整数で、幅は1〜9`);
    out.min = min; out.max = max;
    if (ask.minLabel) out.minLabel = String(ask.minLabel);
    if (ask.maxLabel) out.maxLabel = String(ask.maxLabel);
  } else if (ask.type === 'free_text') {
    if (ask.placeholder) out.placeholder = String(ask.placeholder);
  }
  return out;
}

function normAnswer(ask, a) {
  const bad = (m) => { throw new HttpError(400, m); };
  if (!a || typeof a !== 'object') bad('回答が不正です');
  switch (ask.type) {
    case 'single_choice': {
      const other = String(a.other || '').trim();
      if (a.choice != null && ask.options.some((o) => o.id === a.choice)) return { choice: a.choice };
      if (ask.allowOther && other) return { other };
      return bad('選択肢を選んでください');
    }
    case 'multi_choice': {
      const choices = (Array.isArray(a.choices) ? a.choices : []).filter((c) => ask.options.some((o) => o.id === c));
      const other = ask.allowOther ? String(a.other || '').trim() : '';
      if (!choices.length && !other) bad('1つ以上選んでください');
      return { choices, ...(other ? { other } : {}) };
    }
    case 'yes_no':
      if (typeof a.value !== 'boolean') bad('はい／いいえを選んでください');
      return { value: a.value };
    case 'scale':
      if (!Number.isInteger(a.value) || a.value < ask.min || a.value > ask.max) bad('範囲内の数値を選んでください');
      return { value: a.value };
    default: {
      const text = String(a.text || '').trim();
      if (!text) bad('回答を入力してください');
      return { text };
    }
  }
}

module.exports = { normAsk, normAnswer };
