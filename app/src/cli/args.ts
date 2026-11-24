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

/** 値を取らないオプション（`--名前` だけ）。それ以外の `--名前` は、次の引数を値として取る */
const BOOLEAN_FLAGS = new Set(['no-open', 'view', 'help', 'version']);
/** 短い形（値を取らない）：`-h` ＝ `--help`・`-v` ＝ `--version` */
const SHORT_FLAGS: Record<string, string> = { '-h': 'help', '-v': 'version' };

export function parseArgs(argv: string[]): ParsedArgs {
  const pos: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const short = SHORT_FLAGS[a];
    if (short) flags[short] = true;
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOLEAN_FLAGS.has(k)) flags[k] = true;
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
