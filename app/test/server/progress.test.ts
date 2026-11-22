import assert from 'node:assert/strict';
import { test } from 'vitest';
import { progressOf } from '../../src/shared/progress';
import type { Thread } from '../../src/shared/types';
import {
  addComment,
  makeTopic,
  type Project,
  readThreads,
  removeProject,
  singleAsk,
  submit,
  tempProject,
} from './helpers';

// 壊れた入力も試すので、スレッドの形を、あえて緩く渡す
const count = (threads: unknown) => progressOf(threads as Thread[] | null | undefined);

test('空・壊れた入力でも、0 を返す', () => {
  const zero = { threads: { total: 0, resolved: 0, open: 0 }, asks: { total: 0, answered: 0 } };
  assert.deepEqual(count([]), zero);
  assert.deepEqual(count(undefined), zero);
  assert.deepEqual(count(null), zero);
  assert.deepEqual(count([{ messages: null }]), {
    threads: { total: 1, resolved: 0, open: 1 },
    asks: { total: 0, answered: 0 },
  });
});

const ai = (id: string, ask?: boolean) => ({
  id,
  author: 'ai',
  kind: 'reply',
  ...(ask ? { ask: { type: 'yes_no', question: 'q' } } : {}),
});
const answer = (id: string, to: string, sent: boolean) => ({ id, author: 'user', kind: 'answer', to, sent });

test('解決したスレッドと、質問・送信済みの回答を数える', () => {
  const threads = [
    {
      resolved: true,
      messages: [{ id: 'm1', author: 'user', kind: 'comment', sent: true }, ai('m2', true), answer('m3', 'm2', true)],
    },
    { resolved: false, messages: [ai('m4', true), answer('m5', 'm4', false)] },
    { resolved: false, messages: [ai('m6', true)] },
    { resolved: false, messages: [ai('m7', false)] },
  ];
  assert.deepEqual(count(threads), {
    threads: { total: 4, resolved: 1, open: 3 },
    asks: { total: 3, answered: 1 },
  });
});

test('保存しただけの（未送信の）回答・別の質問への回答は、数えない。同じ質問への回答が複数あっても、1 つ', () => {
  const threads = [
    {
      resolved: false,
      messages: [ai('m1', true), answer('m2', 'm1', true), answer('m3', 'm1', true), answer('m4', 'mX', true)],
    },
  ];
  assert.deepEqual(count(threads).asks, { total: 1, answered: 1 });
  assert.deepEqual(count([{ messages: [ai('m1', true), answer('m2', 'mX', true)] }]).asks, { total: 1, answered: 0 });
});

test('人の発言についた ask は、数えない（AI の質問だけを数える）', () => {
  const t = [
    {
      resolved: false,
      messages: [{ id: 'm1', author: 'user', kind: 'comment', ask: { type: 'yes_no', question: 'q' } }, ai('m2', true)],
    },
  ];
  assert.deepEqual(count(t).asks, { total: 1, answered: 0 });
});

test('AI が起点のスレッド（apply の threads[]。人のコメントがない）の質問も、数える。回答を送ると、答えた数になる', () => {
  const p: Project = tempProject();
  try {
    makeTopic(p);
    p.agent.cmdApply('demo', { threads: [{ page: 'root', body: '確認です', ask: singleAsk }] });
    const th = readThreads(p).threads as [Thread];
    assert.equal(th[0].origin, 'ai');
    assert.deepEqual(progressOf(th), {
      threads: { total: 1, resolved: 0, open: 1 },
      asks: { total: 1, answered: 0 },
    });
    p.actions.answer({
      topic: 'demo',
      thread: th[0].id,
      msg: th[0].messages[0]?.id as string,
      answer: { choice: 'a' },
    });
    submit(p);
    assert.deepEqual(progressOf(readThreads(p).threads).asks, { total: 1, answered: 1 });
  } finally {
    removeProject(p);
  }
});

test('実際の操作の流れ：質問 → 回答を保存（数えない）→ Submit（数える）→ 解決', () => {
  const p: Project = tempProject();
  try {
    makeTopic(p);
    const id = addComment(p);
    submit(p);
    p.agent.cmdApply('demo', { replies: [{ thread: id, body: '質問', ask: singleAsk }] });
    const now = () => progressOf(readThreads(p).threads);
    assert.deepEqual(now(), { threads: { total: 1, resolved: 0, open: 1 }, asks: { total: 1, answered: 0 } });

    const q = readThreads(p).threads[0]?.messages.find((m) => m.ask);
    p.actions.answer({ topic: 'demo', thread: id, msg: q?.id as string, answer: { choice: 'a' } });
    assert.equal(now().asks.answered, 0, '保存しただけ');
    submit(p);
    assert.equal(now().asks.answered, 1, '送信した');

    p.actions.resolve({ topic: 'demo', thread: id, resolved: true });
    assert.equal(now().threads.resolved, 1);
    p.actions.resolve({ topic: 'demo', thread: id, resolved: false });
    assert.equal(now().threads.resolved, 0, '再開すると、減る');
  } finally {
    removeProject(p);
  }
});
