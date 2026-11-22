// CLI の引数とプロジェクトのルート。
import cp from 'node:child_process';
import path from 'node:path';

export interface Flags {
  [name: string]: string | boolean | undefined;
}

export interface ParsedArgs {
  pos: string[];
  flags: Flags;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (k === 'no-open' || k === 'force') flags[k] = true;
      else flags[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, flags };
}

export function projectRoot(flags: Flags): string {
  if (typeof flags.root === 'string' && flags.root) return path.resolve(flags.root);
  try {
    return cp
      .execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      .toString()
      .trim();
  } catch {
    return process.cwd();
  }
}
