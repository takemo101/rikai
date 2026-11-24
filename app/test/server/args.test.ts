// CLI の引数の解釈（cli/args.ts）：値を取るオプションと、取らないオプション（--help・--version・-h・-v・--no-open）の区別。
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseArgs } from '../../src/cli/args';

test('--help・-h・--version・-v は、値を取らない（次の引数を、飲み込まない）', () => {
  assert.deepEqual(parseArgs(['--help', 'poll']), { pos: ['poll'], flags: { help: true } });
  assert.deepEqual(parseArgs(['poll', '-h']), { pos: ['poll'], flags: { help: true } });
  assert.deepEqual(parseArgs(['-v', 'x']), { pos: ['x'], flags: { version: true } });
  assert.deepEqual(parseArgs(['--version', 'x']), { pos: ['x'], flags: { version: true } });
  assert.deepEqual(parseArgs(['open', 'demo', '--no-open', 'x']), {
    pos: ['open', 'demo', 'x'],
    flags: { 'no-open': true },
  });
});

test('値を取るオプションは、次の引数を値にする（-v・-h のような値も、そのまま値）', () => {
  assert.deepEqual(parseArgs(['new', 'demo', '--title', '-v', '--source', '-h']), {
    pos: ['new', 'demo'],
    flags: { title: '-v', source: '-h' },
  });
  assert.deepEqual(parseArgs(['poll', 'demo', '--timeout', '5', '--root', '/x']), {
    pos: ['poll', 'demo'],
    flags: { timeout: '5', root: '/x' },
  });
});
