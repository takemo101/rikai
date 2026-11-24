// `rikai --help`・`rikai <コマンド> --help`・`rikai --version` の文章と、振り分け。
// 副作用がない（ストアを作らない・何も書かない：`infoReply` は、出す文字と終了コードを返すだけ。出力は main.ts）。
// 内容は、実際のコマンドの挙動（server/agent.ts・server/store.ts・cli/main.ts）に合わせる。変えたら、ここも直す（test/server/cli.test.ts が、一覧と実際のコマンドの一致を確かめる）。
import { VERSION } from '../shared/version';
import type { Flags } from './args';

/** 出力先ごとに、色を付けるか（端末で、かつ、環境変数 NO_COLOR がないとき） */
export interface Style {
  stdout: boolean;
  stderr: boolean;
}

export interface Reply {
  stdout?: string;
  stderr?: string;
  code: number;
}

interface Opt {
  flag: string;
  text: string;
  /** 特定のコマンドだけのオプション：全体の一覧では、`new: …` のように、コマンド名を前に付ける */
  only?: string;
}

interface Example {
  note: string;
  /** 複数行のコマンド（ヒアドキュメントなど）は、行ごとに */
  cmd: string[];
}

interface CommandDoc {
  name: string;
  group: 'make' | 'agent' | 'internal';
  /** 一覧の 1 行（`new <topic>` のように、引数まで） */
  synopsis: string;
  /** 一覧・見出しの 1 行の説明 */
  summary: string;
  /** 使い方の行（`rikai ` の次から） */
  usage: string;
  detail: string[];
  options: Opt[];
  input?: string[];
  output: string[];
  examples: Example[];
  see?: string;
}

const ROOT_OPT: Opt = {
  flag: '--root <dir>',
  text: 'プロジェクトのルート（既定: git のルート。git でなければ、現在のディレクトリ）',
};
const TITLE_OPT: Opt = { flag: '--title <題名>', text: 'トピックの題名（既定: topic の名前）', only: 'new' };
const SOURCE_OPT: Opt = { flag: '--source <対象>', text: '資料の対象の説明（既定: なし）', only: 'new' };
const NO_OPEN_OPT: Opt = { flag: '--no-open', text: 'ブラウザを自動で開かない（URL だけ出す）', only: 'open' };
const VIEW_OPT: Opt = {
  flag: '--view',
  text: '終了したトピックを、開き直さずに、閲覧専用で見る（終了のまま。コメントはできない）',
  only: 'open',
};
const TIMEOUT_OPT: Opt = {
  flag: '--timeout <秒>',
  text: '待つ最長の秒数（既定: 43200 ＝ 12 時間）',
  only: 'poll',
};
const HELP_OPT: Opt = {
  flag: '-h, --help',
  text: 'ヘルプを出す（help でも同じ）',
};
const VERSION_OPT: Opt = { flag: '-v, --version', text: 'バージョンを出す（version でも同じ）' };

/** 失敗したときの共通の出力（どのコマンドも同じ） */
const FAIL = '失敗したときは、{"ok": false, "errors": [理由…]} を出して、終了コード 1 で終わる。';

const COMMANDS: CommandDoc[] = [
  {
    name: 'new',
    group: 'make',
    synopsis: 'new <topic>',
    summary: '標準入力の Markdown から、新しいトピック（資料）を作る',
    usage: 'new <topic> [--title <題名>] [--source <対象>]',
    detail: [
      'topic は、トピックの名前（英小文字・数字・ハイフン、48 字以内）。同じ名前が、すでにあるとき・資料が空のときは、失敗する。',
      '作ったあと、`rikai open <topic>` で、ブラウザに出す。',
    ],
    options: [TITLE_OPT, SOURCE_OPT, ROOT_OPT],
    input: ['標準入力：資料の Markdown（必須。ヒアドキュメントか、リダイレクトで渡す）'],
    output: [
      '{"ok": true, "topic", "dir", "rootPage", "assets"}',
      '  dir … トピックの保存先（.rikai/<topic>/）  rootPage … 最初のページ（v1.md）  assets … 画像などを置く場所',
      FAIL,
    ],
    examples: [
      {
        note: 'ヒアドキュメントで渡す',
        cmd: ['rikai new auth-flow --title "認証の流れ" --source "PR #12" <<\'MD\'', '# 認証の流れ', '…', 'MD'],
      },
      { note: 'ファイルから渡す', cmd: ['rikai new auth-flow --title "認証の流れ" < doc.md'] },
    ],
    see: 'open',
  },
  {
    name: 'open',
    group: 'make',
    synopsis: 'open <topic>',
    summary: 'ブラウザで資料を開く（ビューアを起動して、URL を出す）',
    usage: 'open <topic> [--view] [--no-open] [--root <dir>]',
    detail: [
      'ビューア（127.0.0.1 だけで待ち受ける小さなサーバー）が動いていなければ起動し、ブラウザで、トピックを開く。',
      '終了したトピックは、そのまま `open` すると、開き直す（コメントを、また書ける）。開き直さずに、中身だけ見るには、`--view`（終了のまま、閲覧専用で開く）。開いているトピックに付けても、ふつうに開くだけ。',
      '環境変数 NO_OPEN を設定しても、ブラウザは開かない。',
    ],
    options: [VIEW_OPT, NO_OPEN_OPT, ROOT_OPT],
    output: [
      '{"ok": true, "url", "root", "dir"}',
      '  url … 画面の URL。`?t=` の後ろは合言葉なので、人に見せない',
      FAIL,
    ],
    examples: [
      { note: 'ブラウザで開く', cmd: ['rikai open auth-flow'] },
      { note: 'URL だけ出す（ブラウザは開かない）', cmd: ['rikai open auth-flow --no-open'] },
      { note: '終了したトピックを、開き直さずに見る（閲覧専用）', cmd: ['rikai open auth-flow --view'] },
    ],
    see: 'poll・stop',
  },
  {
    name: 'status',
    group: 'make',
    synopsis: 'status [topic]',
    summary: 'トピックの状態（未処理のコメント・進み具合・ページ）を出す',
    usage: 'status [topic] [--root <dir>]',
    detail: ['topic を省くと、このプロジェクトの、すべてのトピックを出す。会話が途切れたあとの、状況の確認に使う。'],
    options: [ROOT_OPT],
    output: [
      'JSON の配列（トピックが 1 つでも、配列）。トピックごとに：',
      '  topic・title・closed（終了したか）・pendingRounds（未処理の round の番号）・unsentInBrowser（まだ送っていないコメントの数）・progress（解決・回答の数）・pages（ページごとの題・版・最新版のファイル）',
      FAIL,
    ],
    examples: [
      { note: 'すべてのトピック', cmd: ['rikai status'] },
      { note: '1 つのトピック', cmd: ['rikai status auth-flow'] },
    ],
  },
  {
    name: 'stop',
    group: 'make',
    synopsis: 'stop',
    summary: 'ビューア（サーバー）を止める',
    usage: 'stop [--root <dir>]',
    detail: [
      'このプロジェクトのビューアを止める。資料・コメントは消えない（`.rikai/` に残る）。動いていなければ、何もしない。',
    ],
    options: [ROOT_OPT],
    output: ['{"ok": true, "stopped": true | false}   stopped … 止めたか（動いていなかったときは false）'],
    examples: [{ note: 'ビューアを止める', cmd: ['rikai stop'] }],
    see: 'open',
  },
  {
    name: 'poll',
    group: 'agent',
    synopsis: 'poll <topic>',
    summary: '「AI に送る」が押されるまで待ち、コメントを JSON で出す',
    usage: 'poll <topic> [--timeout <秒>] [--root <dir>]',
    detail: [
      'ユーザーが、画面で「AI に送る」を押すまで待つ（Claude Code が、バックグラウンドで動かす）。',
      'すでに届いているコメントがあれば、待たずに、すぐ出す。出したあと、返信は `rikai apply` で反映する。',
      '待てないエージェントは、`rikai pull` を使う。',
    ],
    options: [TIMEOUT_OPT, ROOT_OPT],
    output: [
      '1 つの JSON。status で、次の 3 つに分かれる：',
      '  "feedback" … コメントが届いた。round・items（コメントごとの、スレッド・文脈・新しい発言）・pages・overallNote（全体への伝言）などを含む',
      '  "closed"   … ユーザーが「終了」を押した',
      '  "timeout"  … --timeout の間に、届かなかった。もう一度 poll する',
      FAIL,
    ],
    examples: [
      { note: '届くまで待つ（最長 12 時間）', cmd: ['rikai poll auth-flow'] },
      { note: '10 分だけ待つ', cmd: ['rikai poll auth-flow --timeout 600'] },
    ],
    see: 'pull・apply',
  },
  {
    name: 'pull',
    group: 'agent',
    synopsis: 'pull <topic>',
    summary: '待たずに、届いているコメントを出す',
    usage: 'pull <topic> [--root <dir>]',
    detail: [
      '`poll` の、待たない版。ユーザーに「送った」と言われたあとに、読みに行くときに使う。',
      '未処理のコメントが、複数のラウンドにあるときは、いちばん古いものだけを出す。',
    ],
    options: [ROOT_OPT],
    output: [
      '1 つの JSON。status で、次の 3 つに分かれる：',
      '  "feedback" … コメントが届いている（poll と同じ形）',
      '  "closed"   … ユーザーが「終了」を押した',
      '  "none"     … まだ届いていない（message と、まだ送っていない数 unsent）',
      FAIL,
    ],
    examples: [{ note: '届いていれば出す', cmd: ['rikai pull auth-flow'] }],
    see: 'poll・apply',
  },
  {
    name: 'apply',
    group: 'agent',
    synopsis: 'apply <topic>',
    summary: '標準入力の JSON で、返信・新しい版・子ページ・質問を反映する',
    usage: 'apply <topic> [--root <dir>]',
    detail: [
      '返信・資料の新しい版・子ページ・AI からの質問を、1 回の JSON で反映する。すべて検査してから書く（1 つでも誤りがあれば、何も書かない）。',
      '反映すると、その round が処理済みになる。未処理の round が複数あるときは、JSON の round で、どれを処理するか指定する。',
      '入力の詳しい形（ask の型など）は、スキルの本体 SKILL.md（skills/rikai/SKILL.md）にある。',
    ],
    options: [ROOT_OPT],
    input: [
      '標準入力：JSON（キーは、すべて省略できる）',
      '  round        処理する round の番号（未処理の round が複数あるときは、必須）',
      '  replies[]    スレッドへの返信：{thread, body, page?, ask?}',
      '  revisions[]  資料の新しい版（全文）：{page, markdown, title?}',
      '  pages[]      子ページ：{id, title, markdown, parent?}',
      '  threads[]    AI から始めるスレッド（確認の質問など）：{page, body, anchor?, ask?, link?}',
    ],
    output: [
      '{"ok": true, "handledRounds", "newPages", "revised", "repliedThreads", "newThreads"}',
      '  返信していないスレッドがあるときは、unansweredThreads と warning も付く',
      '検査に失敗したときは、何も書かずに {"ok": false, "errors": [理由…]} を出して、終了コード 1 で終わる。',
    ],
    examples: [
      {
        note: '1 つのスレッドに、返信する',
        cmd: ["rikai apply auth-flow <<'JSON'", '{"round": 1, "replies": [{"thread": "t1", "body": "…"}]}', 'JSON'],
      },
    ],
    see: 'poll・pull',
  },
  {
    name: 'serve',
    group: 'internal',
    synopsis: 'serve',
    summary: 'ビューアのサーバー本体（内部用）',
    usage: 'serve [--root <dir>]',
    detail: [
      '`open` が、自動で起動する。直接は使わない（すべてのトピックが終了して、10 分間、画面からのリクエストがないと、自分で終わる）。',
    ],
    options: [ROOT_OPT],
    output: ['何も出さない（起動した情報は、.rikai/.server.json に書く）'],
    examples: [],
  },
];

const REPO_DOC_URL = 'https://github.com/takemo101/rikai#コマンド';
const TAGLINE = 'rikai — 資料にコメントして AI と理解を深めるツール';
const GROUPS: { id: CommandDoc['group']; title: string }[] = [
  { id: 'make', title: '資料を作って見る' },
  { id: 'agent', title: 'AI がコメントを受けて返す' },
];

// ---------------------------------------------------------------- 描画

interface Paint {
  bold(s: string): string;
  cmd(s: string): string;
}

function painter(color: boolean): Paint {
  if (!color) return { bold: (s) => s, cmd: (s) => s };
  return { bold: (s) => `\x1b[1m${s}\x1b[22m`, cmd: (s) => `\x1b[36m${s}\x1b[39m` };
}

/** 表示の幅（全角は 2。そろえるときだけ使う） */
function width(s: string): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) as number) >= 0x1100 ? 2 : 1;
  return w;
}

/** 左の列をそろえた 2 列の表（左は、色を付ける関数を通す。幅は、色を付ける前の文字で測る。`w` は、複数の表で、そろえるとき） */
function table(
  rows: [string, string][],
  color: (s: string) => string,
  w = Math.max(...rows.map(([l]) => width(l))),
): string[] {
  return rows.map(([l, r]) => `  ${color(l)}${' '.repeat(w - width(l))}  ${r}`);
}

export function topHelp(color: boolean): string {
  const p = painter(color);
  const lines: string[] = [TAGLINE, '', `${p.bold('使い方:')} rikai <コマンド> [オプション]`, ''];
  const nameW = Math.max(...COMMANDS.map((c) => width(c.synopsis)));
  for (const g of GROUPS) {
    lines.push(p.bold(g.title));
    lines.push(
      ...table(
        COMMANDS.filter((c) => c.group === g.id).map((c): [string, string] => [c.synopsis, c.summary]),
        p.cmd,
        nameW,
      ),
    );
    lines.push('');
  }
  lines.push(p.bold('オプション'));
  lines.push(
    ...table(
      [ROOT_OPT, TITLE_OPT, SOURCE_OPT, NO_OPEN_OPT, VIEW_OPT, TIMEOUT_OPT, HELP_OPT, VERSION_OPT].map(
        (o): [string, string] => [o.flag, o.only ? `${o.only}: ${o.text}` : o.text],
      ),
      (s) => s,
    ),
  );
  lines.push('');
  lines.push(p.bold('例'));
  lines.push(
    ...table(
      [
        ['rikai new auth-flow --title "認証の流れ" < doc.md', '# 資料を作る'],
        ['rikai open auth-flow', '# ブラウザで開く'],
        ['rikai poll auth-flow', '# 「AI に送る」が押されるまで待つ'],
        ['rikai apply auth-flow < reply.json', '# 返信を反映する'],
      ],
      (s) => s,
    ),
  );
  lines.push('');
  lines.push(`コマンドごとの詳しい説明: rikai <コマンド> --help（例: rikai poll --help）`);
  lines.push(`ドキュメント: ${REPO_DOC_URL}`);
  lines.push(`内部用: serve（open が、自動で起動する。直接は使わない）`);
  return `${lines.join('\n')}\n`;
}

function commandHelp(c: CommandDoc, color: boolean): string {
  const p = painter(color);
  const lines: string[] = [`rikai ${c.name} — ${c.summary}`, '', `${p.bold('使い方:')} rikai ${p.cmd(c.usage)}`, ''];
  for (const d of c.detail) lines.push(d);
  lines.push('');
  lines.push(p.bold('オプション'));
  lines.push(
    ...table(
      [...c.options, HELP_OPT].map((o): [string, string] => [o.flag, o.text]),
      (s) => s,
    ),
  );
  if (c.input) {
    lines.push('', p.bold('入力'));
    for (const l of c.input) lines.push(`  ${l}`);
  }
  lines.push('', p.bold('出力'));
  for (const l of c.output) lines.push(`  ${l}`);
  if (c.examples.length) {
    lines.push('', p.bold('例'));
    c.examples.forEach((e, i) => {
      if (i) lines.push('');
      lines.push(`  # ${e.note}`);
      for (const l of e.cmd) lines.push(`  ${l}`);
    });
  }
  if (c.see) lines.push('', `関連: ${c.see}`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- 振り分け

/** 本物のコマンドの名前（一覧と、実際の振り分けが、食い違わないことを、テストが確かめる） */
export const COMMAND_NAMES: readonly string[] = COMMANDS.map((c) => c.name);

function unknown(name: string, style: Style): Reply {
  return { stderr: `未知のコマンド: ${name}\n\n${topHelp(style.stderr)}`, code: 1 };
}

/**
 * ヘルプ・バージョンの要求なら、出す文字と終了コードを返す（そうでなければ null：コマンドを実行する）。
 * ここで返すものは、ストアを作らず、プロジェクトに何も書かない。
 *  - `--help`・`-h`・`help [コマンド]`・引数なし → ヘルプ（標準出力・終了コード 0）。`<コマンド> --help` は、そのコマンドの詳しい説明
 *  - `--version`・`-v`・`version` → `rikai 0.1.2`（標準出力・終了コード 0）
 *  - 未知のコマンド（`--help` を付けても）→ 「未知のコマンド: xxx」とヘルプを、標準エラー・終了コード 1
 */
export function infoReply(pos: string[], flags: Flags, style: Style): Reply | null {
  const cmd = pos[0];
  const wantsHelp = !!flags.help || cmd === 'help' || (cmd === undefined && !flags.version);
  const wantsVersion = !!flags.version || cmd === 'version';
  if (!wantsHelp && !wantsVersion) {
    return cmd !== undefined && !COMMAND_NAMES.includes(cmd) ? unknown(cmd, style) : null;
  }
  // `rikai help poll` は、`rikai poll --help` と同じ
  const target = cmd === 'help' ? pos[1] : cmd;
  if (target !== undefined && target !== 'help' && target !== 'version' && !COMMAND_NAMES.includes(target))
    return unknown(target, style);
  if (!wantsHelp) return { stdout: `rikai ${VERSION}\n`, code: 0 };
  const doc = COMMANDS.find((c) => c.name === target);
  return { stdout: doc ? commandHelp(doc, style.stdout) : topHelp(style.stdout), code: 0 };
}
