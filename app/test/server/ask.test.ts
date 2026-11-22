import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normAnswer, normAsk } from '../../src/server/ask';
import type { Ask, Message } from '../../src/shared/types';
import {
  addComment,
  httpError,
  makeTopic,
  readThreads,
  removeProject,
  singleAsk,
  submit as submitRound,
  tempProject,
} from './helpers';

// 検査に通った質問として読む（形が不正なら、テストの前提が崩れている）
const mk = (a: unknown): Ask => normAsk(a, 'x', []) as Ask;

const check = (ask: unknown) => {
  const errs: string[] = [];
  const out = normAsk(ask, 'x', errs);
  return { out, errs };
};

test('ask：型ごとの必須項目を検査する', () => {
  assert.deepEqual(check(singleAsk).errs, []);
  assert.deepEqual(check({ type: 'yes_no', question: '合ってる？' }).errs, []);
  assert.deepEqual(check({ type: 'free_text', question: '言い直して' }).errs, []);
  assert.deepEqual(
    check({ type: 'scale', question: '腑に落ちた？', min: 1, max: 5, minLabel: '全く', maxLabel: '十分' }).errs,
    [],
  );

  assert.ok(
    check({ type: 'single_choice', question: 'q', options: [{ id: 'a', label: 'A' }] }).errs.length,
    '選択肢が1つ',
  );
  assert.ok(
    check({
      type: 'single_choice',
      question: 'q',
      options: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ],
    }).errs.length,
    'ID の重複',
  );
  assert.ok(
    check({ type: 'multi_choice', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b' }] }).errs.length,
    'label がない',
  );
  assert.ok(check({ type: 'yes_no', question: '' }).errs.length, '質問が空');
  assert.ok(check({ type: 'scale', question: 'q', min: 5, max: 1 }).errs.length, '範囲が逆');
  assert.ok(check({ type: 'scale', question: 'q', min: 0, max: 20 }).errs.length, '幅が大きすぎる');
  assert.ok(check({ type: 'pick_one', question: 'q' }).errs.length, '知らない型');
  assert.equal(check(null).out, null, 'ask なしは null');
});

test('ask：保存する形に正規化し、余計なキーを持ち込まない', () => {
  const { out } = check({
    ...singleAsk,
    evil: '<script>',
    options: [
      { id: 'a', label: 'A', extra: 1 },
      { id: 'b', label: 'B', detail: '説明' },
    ],
  });
  assert.deepEqual(out, {
    type: 'single_choice',
    question: '冪等なのは？',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', detail: '説明' },
    ],
    allowOther: false,
  });
});

test('回答：質問に照らして検査する', () => {
  const single = mk({ ...singleAsk, allowOther: true });
  assert.deepEqual(normAnswer(single, { choice: 'a' }), { choice: 'a' });
  assert.deepEqual(normAnswer(single, { other: ' その他の答え ' }), { other: 'その他の答え' });
  assert.throws(() => normAnswer(single, { choice: 'zzz' }), httpError(400));
  assert.throws(() => normAnswer(single, {}), httpError(400));
  const noOther = mk(singleAsk);
  assert.throws(
    () => normAnswer(noOther, { other: '自由入力' }),
    httpError(400),
    'allowOther でなければ、自由入力は受けない',
  );

  const multi = mk({ ...singleAsk, type: 'multi_choice' });
  assert.deepEqual(normAnswer(multi, { choices: ['a', 'zzz', 'b'] }), { choices: ['a', 'b'] });
  assert.throws(() => normAnswer(multi, { choices: ['zzz'] }), httpError(400));

  const yn = mk({ type: 'yes_no', question: 'q' });
  assert.deepEqual(normAnswer(yn, { value: false }), { value: false });
  assert.throws(() => normAnswer(yn, { value: 'yes' }), httpError(400));

  const scale = mk({ type: 'scale', question: 'q' });
  assert.deepEqual(normAnswer(scale, { value: 5 }), { value: 5 });
  assert.throws(() => normAnswer(scale, { value: 6 }), httpError(400));
  assert.throws(() => normAnswer(scale, { value: 2.5 }), httpError(400));

  const free = mk({ type: 'free_text', question: 'q' });
  assert.deepEqual(normAnswer(free, { text: ' 自分の言葉 ' }), { text: '自分の言葉' });
  assert.throws(() => normAnswer(free, { text: '   ' }), httpError(400));
});

test('回答：複数選択は、allowOther でなければ自由入力を持たず、allowOther なら自由入力だけでも受ける', () => {
  const multi = mk({ ...singleAsk, type: 'multi_choice' });
  assert.throws(() => normAnswer(multi, { choices: [], other: '自由入力' }), httpError(400, /1つ以上/));
  assert.deepEqual(normAnswer(multi, { choices: ['a'], other: '自由入力' }), { choices: ['a'] });
  const multiOther = mk({ ...singleAsk, type: 'multi_choice', allowOther: true });
  assert.deepEqual(normAnswer(multiOther, { choices: [], other: ' 自由入力 ' }), { choices: [], other: '自由入力' });
});

test('回答の流れ：保存 → 選び直し → 取り消し → Submit のあとは変えられない', () => {
  const p = tempProject();
  try {
    makeTopic(p);
    const id = addComment(p);
    submitRound(p);
    p.agent.cmdApply('demo', { replies: [{ thread: id, body: '質問です', ask: singleAsk }] });
    const q = readThreads(p).threads[0]?.messages.find((m) => m.ask) as Message;
    const answers = () => (readThreads(p).threads[0]?.messages ?? []).filter((m) => m.kind === 'answer');
    const answer = (a: unknown) => p.actions.answer({ topic: 'demo', thread: id, msg: q.id, answer: a });

    answer({ choice: 'a' });
    answer({ choice: 'b' });
    assert.equal(answers().length, 1, '未送信の回答は、置き換わる');
    assert.deepEqual(answers()[0]?.answer, { choice: 'b' });
    assert.throws(() => answer({ choice: 'zzz' }), httpError(400));
    assert.deepEqual(answers()[0]?.answer, { choice: 'b' }, '不正な回答で、保存済みの回答が壊れない');

    answer(null);
    assert.equal(answers().length, 0);

    answer({ choice: 'a' });
    submitRound(p);
    assert.equal(answers()[0]?.sent, true);
    assert.throws(() => answer({ choice: 'b' }), httpError(400, /送信済みの回答/));
    assert.throws(() => answer(null), httpError(400, /送信済みの回答/));
    assert.deepEqual(answers()[0]?.answer, { choice: 'a' });
    assert.throws(
      () => p.actions.answer({ topic: 'demo', thread: id, msg: 'm99', answer: { choice: 'a' } }),
      httpError(404),
    );
  } finally {
    removeProject(p);
  }
});
