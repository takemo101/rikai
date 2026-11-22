#!/usr/bin/env bash
# rikai を ~/.claude/skills/rikai にコピーする。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}/rikai"
command -v node >/dev/null || { echo "Node.js 22 以上が必要です" >&2; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Node.js 22 以上が必要です" >&2; exit 1; }
mkdir -p "$dest"
rsync -a --delete "$here/skills/rikai/" "$dest/"
echo "インストールしました: $dest"
echo "Claude Code を開き直すと /rikai が使えます"
