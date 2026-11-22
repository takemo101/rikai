// ask（AI から人への質問）の検証：AI が出す質問の形（normAsk）と、人の回答の形（normAnswer）。
import type { Ask, AskAnswer, AskOption, AskType } from '../shared/types';
import { HttpError } from './util';

const ASK_TYPES: readonly AskType[] = ['single_choice', 'multi_choice', 'yes_no', 'scale', 'free_text'];

type Loose = Record<string, unknown>;

// 検査に失敗したときも、旧実装と同じに、できる範囲の形を返す（errs に積む。呼ぶ側が、まとめて 400 にする）。
// 内部は、組み立て中の形を緩く持ち、最後に Ask として返す
export function normAsk(ask: unknown, where: string, errs: string[]): Ask | null {
  if (ask == null) return null;
  const a = ask as Loose;
  if (typeof ask !== 'object' || !ASK_TYPES.includes(a.type as AskType)) {
    errs.push(`${where}.ask.type は ${ASK_TYPES.join(' / ')} のどれか`);
    return null;
  }
  const type = a.type as AskType;
  const out: Loose = { type, question: String(a.question || '').trim() };
  if (!out.question) errs.push(`${where}.ask.question が空です`);
  if (type === 'single_choice' || type === 'multi_choice') {
    const opts: unknown[] = Array.isArray(a.options) ? a.options : [];
    if (opts.length < 2 || opts.length > 8) errs.push(`${where}.ask.options は2〜8個`);
    const ids = new Set<string>();
    const options: AskOption[] = [];
    for (const raw of opts) {
      const o = raw as Loose | null | undefined;
      const id = String(o?.id || '').trim();
      const label = String(o?.label || '').trim();
      if (!id || !label) {
        errs.push(`${where}.ask.options の id と label は必須`);
        continue;
      }
      if (ids.has(id)) errs.push(`${where}.ask.options の id が重複: ${id}`);
      ids.add(id);
      options.push({ id, label, ...(o?.detail ? { detail: String(o.detail) } : {}) });
    }
    out.options = options;
    out.allowOther = !!a.allowOther;
  } else if (type === 'scale') {
    const min = a.min == null ? 1 : a.min;
    const max = a.max == null ? 5 : a.max;
    if (
      !Number.isInteger(min) ||
      !Number.isInteger(max) ||
      (max as number) <= (min as number) ||
      (max as number) - (min as number) > 9
    )
      errs.push(`${where}.ask の min/max は整数で、幅は1〜9`);
    out.min = min;
    out.max = max;
    if (a.minLabel) out.minLabel = String(a.minLabel);
    if (a.maxLabel) out.maxLabel = String(a.maxLabel);
  } else if (type === 'free_text') {
    if (a.placeholder) out.placeholder = String(a.placeholder);
  }
  return out as unknown as Ask;
}

export function normAnswer(ask: Ask, a: unknown): AskAnswer {
  const bad = (m: string): never => {
    throw new HttpError(400, m);
  };
  if (!a || typeof a !== 'object') bad('回答が不正です');
  const o = a as Loose;
  switch (ask.type) {
    case 'single_choice': {
      const other = String(o.other || '').trim();
      if (o.choice != null && ask.options.some((x) => x.id === o.choice)) return { choice: o.choice as string };
      if (ask.allowOther && other) return { other };
      return bad('選択肢を選んでください');
    }
    case 'multi_choice': {
      const choices = (Array.isArray(o.choices) ? (o.choices as string[]) : []).filter((c) =>
        ask.options.some((x) => x.id === c),
      );
      const other = ask.allowOther ? String(o.other || '').trim() : '';
      if (!choices.length && !other) bad('1つ以上選んでください');
      return { choices, ...(other ? { other } : {}) };
    }
    case 'yes_no':
      if (typeof o.value !== 'boolean') bad('はい／いいえを選んでください');
      return { value: o.value as boolean };
    case 'scale':
      if (!Number.isInteger(o.value) || (o.value as number) < ask.min || (o.value as number) > ask.max)
        bad('範囲内の数値を選んでください');
      return { value: o.value as number };
    default: {
      const text = String(o.text || '').trim();
      if (!text) bad('回答を入力してください');
      return { text };
    }
  }
}
