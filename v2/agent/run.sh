#!/bin/zsh
#
# One unattended pass over v2.  Fired by launchd every three hours; see
# ~/Library/LaunchAgents/net.johnbrophy.hedgepig.plist.
#
#   stop it     launchctl bootout gui/$(id -u)/net.johnbrophy.hedgepig
#   start it    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/net.johnbrophy.hedgepig.plist
#   run one now zsh ~/hedgepig/v2/agent/run.sh
#   watch it    tail -f ~/hedgepig/v2/.agent/latest.log
#
set -u

REPO="$HOME/hedgepig"
V2="$REPO/v2"
DIR="$V2/.agent"
LOCK="$DIR/run.lock"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$DIR/run-$STAMP.log"

mkdir -p "$DIR"
ln -sfn "$LOG" "$DIR/latest.log"

say() { print -r -- "[$(date '+%F %T')] $*" >> "$LOG"; }

# --- one at a time -----------------------------------------------------------
# A run can outlive its three hours.  Overlapping runs would fight over the
# working tree, so a second one simply steps aside.  A lock older than four
# hours is assumed dead.
if [[ -f "$LOCK" ]]; then
  if [[ -n "$(find "$LOCK" -mmin +240 2>/dev/null)" ]]; then
    say "stale lock from $(cat "$LOCK" 2>/dev/null), taking it"
    rm -f "$LOCK"
  else
    say "another run is still going (pid $(cat "$LOCK" 2>/dev/null)) — skipping"
    exit 0
  fi
fi
print -r -- "$$" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

# --- never fight the human ---------------------------------------------------
# If the tree is dirty someone is mid-edit, or a previous run failed to clean
# up.  Either way an autonomous pass would trample it.
cd "$V2" || { say "no $V2"; exit 1; }
DIRTY="$(git -C "$REPO" status --porcelain -- v2 | head -20)"
if [[ -n "$DIRTY" ]]; then
  say "working tree is dirty — skipping this run so nothing is trampled:"
  say "$DIRTY"
  exit 0
fi

say "starting; head is $(git -C "$REPO" rev-parse --short HEAD)"

CLAUDE="$HOME/.local/bin/claude"
[[ -x "$CLAUDE" ]] || CLAUDE="$(command -v claude)"

"$CLAUDE" \
  --print \
  --dangerously-skip-permissions \
  --add-dir "$REPO" \
  "$(cat "$V2/AGENT.md")" \
  >> "$LOG" 2>&1

CODE=$?
say "finished with exit $CODE; head is now $(git -C "$REPO" rev-parse --short HEAD)"

# keep the last fortnight of logs and no more
find "$DIR" -name 'run-*.log' -mtime +14 -delete 2>/dev/null

exit $CODE
