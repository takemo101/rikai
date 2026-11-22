// テスト共通の道具。作り物の資料・コメントだけを使い、一時のプロジェクトで動かす（利用者の .rikai には触れない）。
// 旧 helpers.js は、モジュールの変数（ROOT）に、プロジェクトを覚えさせた。ここは、Project（ストア・操作・フック）を、引数で渡す。
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ActionHooks, type Actions, createActions } from '../../src/server/actions';
import { type Agent, createAgent } from '../../src/server/agent';
import { createStore, type Store } from '../../src/server/store';
import { HttpError } from '../../src/server/util';
import type { Anchor, Ask, Meta, ThreadsFile } from '../../src/shared/types';

export const ROOT_MD = '# 題\n\n本文です。\n\n| 項目 | 値 |\n| --- | --- |\n| 有効期限 | 15分 |\n';

/** 一時のプロジェクト 1 つぶん。hooks は、テストが差し替えてよい（createActions と共有） */
export interface Project {
  dir: string;
  store: Store;
  actions: Actions;
  agent: Agent;
  hooks: ActionHooks;
}

export function tempProject(): Project {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rikai-test-'));
  const store = createStore(dir);
  const hooks: ActionHooks = {};
  return { dir, store, actions: createActions(store, hooks), agent: createAgent(store), hooks };
}

export function removeProject(p: Project): void {
  fs.rmSync(p.dir, { recursive: true, force: true });
}

export function makeTopic(p: Project, slug = 'demo', md = ROOT_MD): Meta {
  return p.store.newTopic(slug, '題', '試験', md);
}

export function textAnchor(quote = '本文'): Anchor {
  return {
    blockId: 'b1',
    blockHash: 'h1',
    blockTag: 'P',
    blockText: '本文です。',
    quote,
    prefix: '',
    suffix: '',
    label: '',
  };
}

/** 人間のコメントを 1 件つける。スレッド ID を返す */
export function addComment(p: Project, over: Record<string, unknown> = {}): string {
  const r = p.actions.comment({
    topic: 'demo',
    page: 'root',
    version: 1,
    anchor: textAnchor(),
    text: '質問です',
    ...over,
  });
  return r.thread;
}

/** 人間の操作から Submit まで。round の番号を返す */
export function submit(p: Project, note?: string): number {
  return p.actions.submit({ topic: 'demo', note }).round;
}

export function readThreads(p: Project, slug = 'demo'): ThreadsFile {
  return p.store.loadThreads(slug);
}

/** 例外が HttpError で、状態コードと文言が合うこと（assert.throws の検証関数・vitest の toThrow には、下の httpErrorMatch を使う） */
export function httpError(status: number, pattern?: RegExp): (e: unknown) => boolean {
  return (e) => e instanceof HttpError && e.status === status && (!pattern || pattern.test(e.message));
}

export const singleAsk: Ask = {
  type: 'single_choice',
  question: '冪等なのは？',
  options: [
    { id: 'a', label: '足す' },
    { id: 'b', label: 'セットする' },
  ],
  allowOther: false,
};

/**
 * バンドルした CLI（globalSetup が、配布と同じやり方で .build/rikai.js に出す）を、子プロセスで動かす。
 * ブラウザは開かない（NO_OPEN）。非 0 で終わると、execFileSync が投げる（error.stdout に出力が残る）
 */
export function runCli(root: string, args: string[], input = ''): string {
  const cli = process.env.RIKAI_CLI;
  if (!cli) throw new Error('RIKAI_CLI がありません（test/setup/cli.ts が、CLI をバンドルして設定する）');
  return cp.execFileSync(process.execPath, [cli, ...args, '--root', root], {
    input,
    encoding: 'utf8',
    env: { ...process.env, NO_OPEN: '1' },
  });
}

/** runCli の、終了コードも見る版（失敗を、投げずに返す） */
export function cliResult(
  root: string,
  args: string[],
  input = '',
  env: NodeJS.ProcessEnv = { NO_OPEN: '1' },
): { status: number | null; stdout: string } {
  const cli = process.env.RIKAI_CLI;
  if (!cli) throw new Error('RIKAI_CLI がありません（test/setup/cli.ts が、CLI をバンドルして設定する）');
  const r = cp.spawnSync(process.execPath, [cli, ...args, '--root', root], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout };
}
