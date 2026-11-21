'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rikai, tempProject, removeProject, makeTopic, addComment, submit, readThreads, httpError, singleAsk } = require('./helpers.js');

const check = (ask) => { const errs = []; const out = rikai.normAsk(ask, 'x', errs); return { out, errs }; };

test('ask：型ごとの必須項目を検査する', () => {
  assert.deepEqual(check(singleAsk).errs, []);
  assert.deepEqual(check({ type: 'yes_no', question: '合ってる？' }).errs, []);
  assert.deepEqual(check({ type: 'free_text', question: '言い直して' }).errs, []);
  assert.deepEqual(check({ type: 'scale', question: '腑に落ちた？', min: 1, max: 5, minLabel: '全く', maxLabel: '十分' }).errs, []);

  assert.ok(check({ type: 'single_choice', question: 'q', options: [{ id: 'a', label: 'A' }] }).errs.length, '選択肢が1つ');
  assert.ok(check({ type: 'single_choice', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }).errs.length, 'ID の重複');
  assert.ok(check({ type: 'multi_choice', question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b' }] }).errs.length, 'label がない');
  assert.ok(check({ type: 'yes_no', question: '' }).errs.length, '質問が空');
  assert.ok(check({ type: 'scale', question: 'q', min: 5, max: 1 }).errs.length, '範囲が逆');
  assert.ok(check({ type: 'scale', question: 'q', min: 0, max: 20 }).errs.length, '幅が大きすぎる');
  assert.ok(check({ type: 'pick_one', question: 'q' }).errs.length, '知らない型');
  assert.equal(check(null).out, null, 'ask なしは null');
});

test('ask：保存する形に正規化し、余計なキーを持ち込まない', () => {
  const { out } = check({ ...singleAsk, evil: '<script>', options: [{ id: 'a', label: 'A', extra: 1 }, { id: 'b', label: 'B', detail: '説明' }] });
  assert.deepEqual(out, { type: 'single_choice', question: '冪等なのは？', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', detail: '説明' }], allowOther: false });
});

test('回答：質問に照らして検査する', () => {
  const single = rikai.normAsk({ ...singleAsk, allowOther: true }, 'x', []);
  assert.deepEqual(rikai.normAnswer(single, { choice: 'a' }), { choice: 'a' });
  assert.deepEqual(rikai.normAnswer(single, { other: ' その他の答え ' }), { other: 'その他の答え' });
  assert.throws(() => rikai.normAnswer(single, { choice: 'zzz' }), httpError(400));
  assert.throws(() => rikai.normAnswer(single, {}), httpError(400));
  const noOther = rikai.normAsk(singleAsk, 'x', []);
  assert.throws(() => rikai.normAnswer(noOther, { other: '自由入力' }), httpError(400), 'allowOther でなければ、自由入力は受けない');

  const multi = rikai.normAsk({ ...singleAsk, type: 'multi_choice' }, 'x', []);
  assert.deepEqual(rikai.normAnswer(multi, { choices: ['a', 'zzz', 'b'] }), { choices: ['a', 'b'] });
  assert.throws(() => rikai.normAnswer(multi, { choices: ['zzz'] }), httpError(400));

  const yn = rikai.normAsk({ type: 'yes_no', question: 'q' }, 'x', []);
  assert.deepEqual(rikai.normAnswer(yn, { value: false }), { value: false });
  assert.throws(() => rikai.normAnswer(yn, { value: 'yes' }), httpError(400));

  const scale = rikai.normAsk({ type: 'scale', question: 'q' }, 'x', []);
  assert.deepEqual(rikai.normAnswer(scale, { value: 5 }), { value: 5 });
  assert.throws(() => rikai.normAnswer(scale, { value: 6 }), httpError(400));
  assert.throws(() => rikai.normAnswer(scale, { value: 2.5 }), httpError(400));

  const free = rikai.normAsk({ type: 'free_text', question: 'q' }, 'x', []);
  assert.deepEqual(rikai.normAnswer(free, { text: ' 自分の言葉 ' }), { text: '自分の言葉' });
  assert.throws(() => rikai.normAnswer(free, { text: '   ' }), httpError(400));
});

test('回答の流れ：保存 → 選び直し → 取り消し → Submit のあとは変えられない', () => {
  const dir = tempProject();
  try {
    makeTopic();
    const id = addComment();
    submit();
    rikai.cmdApply('demo', { replies: [{ thread: id, body: '質問です', ask: singleAsk }] });
    const q = readThreads().threads[0].messages.find((m) => m.ask);
    const answers = () => readThreads().threads[0].messages.filter((m) => m.kind === 'answer');
    const answer = (a) => rikai.actions.answer({ topic: 'demo', thread: id, msg: q.id, answer: a });

    answer({ choice: 'a' });
    answer({ choice: 'b' });
    assert.equal(answers().length, 1, '未送信の回答は、置き換わる');
    assert.deepEqual(answers()[0].answer, { choice: 'b' });
    assert.throws(() => answer({ choice: 'zzz' }), httpError(400));
    assert.deepEqual(answers()[0].answer, { choice: 'b' }, '不正な回答で、保存済みの回答が壊れない');

    answer(null);
    assert.equal(answers().length, 0);

    answer({ choice: 'a' });
    submit();
    assert.equal(answers()[0].sent, true);
    assert.throws(() => answer({ choice: 'b' }), httpError(400, /送信済みの回答/));
    assert.throws(() => answer(null), httpError(400, /送信済みの回答/));
    assert.deepEqual(answers()[0].answer, { choice: 'a' });
    assert.throws(() => rikai.actions.answer({ topic: 'demo', thread: id, msg: 'm99', answer: { choice: 'a' } }), httpError(404));
  } finally {
    removeProject(dir);
  }
});
