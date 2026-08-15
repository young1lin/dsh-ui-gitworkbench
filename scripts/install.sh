#!/usr/bin/env bash
# =============================================================================
# dsh-ui-gitworkbench one-shot installer (official CLI path; macOS / Linux /
# Windows Git Bash)
#
# Installs the npm package and mounts it through the official plugin command:
#   dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench@<version>
#
# The package declares dsh.bundle.patch (cordis.patch.yml), so the CLI's bundle
# coordination registers it into the profile's dsh.profile.bundles and mounts
# the host half on next start -- no manual cordis.patch.yml mount entry.
#
# Usage:
#   bash scripts/install.sh [version] [--restart] [--dry-run]
#
#   version      npm version/range, default latest (resolved to newest).
#                Examples: 0.1.0, ^0.1.0, latest
#   --restart    After install, try `pm2 restart dsh-web` (hint only when pm2
#                is absent). Restarting drops the current page session.
#   --dry-run    Print the planned steps, write nothing.
#   -h/--help    Print this help.
#
# Environment (all optional; auto-detected):
#   DSH_HOME    default ~/.dsh ($USERPROFILE/.dsh under Git Bash)
#   REGISTRY    default https://registry.npmjs.org
#   DSH_CMD     default: dsh on PATH, else npx -y --package @deepseek-ai/dsh
#
# Notes:
# - pnpm 11 minimumReleaseAge rejects versions published <24h ago; the script
#   pre-writes minimumReleaseAgeExclude for this package (idempotent) so a
#   fresh release installs on first try.
# - Older installs used a manual link: dependency + cordis.patch.yml mount
#   entry. The script removes both idempotently (double mounting = two host
#   halves and two chips).
# - Rollback: dsh plugin --profile web remove @young1lin/dsh-ui-gitworkbench
# =============================================================================
set -euo pipefail

for arg in "$@"; do
  if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
    cat <<'EOF'
dsh-ui-gitworkbench one-shot installer

Usage: bash scripts/install.sh [version] [--restart] [--dry-run]

  version      npm version/range, default latest. Examples: 0.1.0, ^0.1.0
  --restart    try `pm2 restart dsh-web` after install (hint when pm2 absent)
  --dry-run    print planned steps, write nothing

Environment (optional): DSH_HOME (~/.dsh), REGISTRY (npmjs), DSH_CMD (dsh)
EOF
    exit 0
  fi
done

DSH_HOME="${DSH_HOME:-${HOME:-${USERPROFILE:-}}/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/web"
WS_YML="$PROFILE_DIR/pnpm-workspace.yaml"
PATCH_YML="$PROFILE_DIR/cordis.patch.yml"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
PKG="@young1lin/dsh-ui-gitworkbench"
DSH_CMD="${DSH_CMD:-dsh}"

RESTART=false
DRY_RUN=false
VERSION_SPEC=""
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) : ;;
    -*) echo "unknown flag: $arg (use -h for usage)" >&2; exit 2 ;;
    *) VERSION_SPEC="$arg" ;;
  esac
done

say()  { printf '\033[32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

resolve_spec() {
  local given="${1:-latest}"
  case "$given" in
    latest)
      local v=""
      if command -v npm >/dev/null 2>&1; then
        v="$(npm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -z "$v" ] && command -v pnpm >/dev/null 2>&1; then
        v="$(pnpm view "$PKG" version --registry="$REGISTRY" 2>/dev/null)" || v=""
      fi
      if [ -n "$v" ]; then
        printf '%s' "$v"
      else
        warn "cannot resolve latest version (npm/pnpm query failed); falling back to latest"
        warn "if you know the version, pass it explicitly: bash scripts/install.sh 0.1.0"
        printf 'latest'
      fi
      ;;
    *) printf '%s' "$given" ;;
  esac
}

dsh_cli() {
  if command -v "$DSH_CMD" >/dev/null 2>&1; then
    printf '%s' "$DSH_CMD"
  elif command -v npx >/dev/null 2>&1; then
    printf 'npx -y --package @deepseek-ai/dsh dsh'
  else
    die "neither dsh nor npx found. install DSH (and Node/npm), or set DSH_CMD."
  fi
}

command -v node >/dev/null 2>&1 || die "node not found (DSH needs Node.js >= 20)."
[ -d "$PROFILE_DIR" ] || die "profile directory not found: ${PROFILE_DIR} (run dsh web once first)"
[ -f "$WS_YML" ]      || die "${WS_YML} not found (initialize the web profile first)"

SPEC="$(resolve_spec "$VERSION_SPEC")"
CLI="$(dsh_cli)"
say "target: $CLI plugin --profile web add $PKG@${SPEC} (profile: ${PROFILE_DIR})"

if [ "$DRY_RUN" = true ]; then
  say "[dry-run] step 1: ensure $WS_YML has minimumReleaseAgeExclude (${PKG})"
  say "[dry-run] step 2: run $CLI plugin --profile web add $PKG@${SPEC} (install + bundle registration)"
  say "[dry-run] step 3: verify dsh.profile.bundles contains ${PKG}"
  say "[dry-run] step 4: idempotently drop the old manual gitworkbench mount entry in $PATCH_YML (if any)"
  if [ "$RESTART" = true ]; then say "[dry-run] step 5: pm2 restart dsh-web"; else say "[dry-run] step 5: prompt for manual DSH restart"; fi
  exit 0
fi

# Step 1: pre-write workspace settings (idempotent) so pnpm 11 accepts a
# version published less than 24h ago.
WS_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
const pkg = process.argv[2];
let t = fs.readFileSync(p, "utf8");
const before = t;
const re = new RegExp("^\\s*-\\s+" + pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m");
if (!re.test(t)) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n  - " + pkg);
  } else {
    t += "\nminimumReleaseAgeExclude:\n  - " + pkg + "\n";
  }
}
if (t !== before) fs.writeFileSync(p, t);
console.log(t === before ? "unchanged" : "updated");
' "$WS_YML" "$PKG")"
[ "$WS_RESULT" = "updated" ] \
  && say "ensured ${WS_YML}: minimumReleaseAgeExclude (${PKG})" \
  || say 'workspace settings already fine, skipped'

# Step 2: official CLI install + bundle registration (mount included)
say "running $CLI plugin --profile web add $PKG@$SPEC ..."
if ! $CLI plugin --profile web add "$PKG@$SPEC" 2>&1 | tail -n +1; then
  warn 'dsh plugin add failed. likely causes:'
  warn '  - network/auth: npm registry unreachable or auth required.'
  warn "  - dependency conflict: retry manually: cd $PROFILE_DIR && pnpm install"
  exit 1
fi

# Step 3: verify the bundle got registered (the sign mounting took effect)
if ! node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const bundles = p.dsh?.profile?.bundles ?? [];
  process.exit(bundles.includes(process.argv[2]) ? 0 : 1);
' "$PROFILE_DIR/package.json" "$PKG"; then
  warn "${PKG} missing from dsh.profile.bundles -- bundle registration failed."
  exit 1
fi
say "bundle registered: dsh.profile.bundles contains ${PKG} (mounts on next start)"

# Step 4: idempotently remove an old manual mount entry (double-mount guard)
if [ -f "$PATCH_YML" ]; then
  MOUNT_RESULT="$(node -e '
const fs = require("fs");
const p = process.argv[1];
const lines = fs.readFileSync(p, "utf8").split("\n");
const out = [];
let i = 0;
let removed = false;
while (i < lines.length) {
  const line = lines[i];
  if (/^[ \t]*- insert:\s*$/.test(line)) {
    const block = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !/^-\s/.test(lines[j])) {
      block.push(lines[j]);
      j++;
    }
    if (block.some((l) => /id:\s*ui-gitworkbench\b/.test(l) || /name:\s*'\''\@young1lin\/dsh-ui-gitworkbench'\''/.test(l))) {
      while (out.length && /^[ \t]*#/.test(out[out.length - 1])) out.pop();
      i = j;
      removed = true;
      continue;
    }
  }
  out.push(line);
  i++;
}
if (!removed) {
  console.log("none");
} else {
  const t = out.join("\n").replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(p, t);
  console.log("removed");
}
' "$PATCH_YML")"
  [ "$MOUNT_RESULT" = "removed" ] \
    && say "removed the old manual gitworkbench mount entry from $PATCH_YML (bundle channel takes over)" \
    || say 'no stale manual mount entry, skipped'
fi

say "install complete: $PKG@$SPEC"

# Step 5: restart guidance
if [ "$RESTART" = true ]; then
  if command -v pm2 >/dev/null 2>&1; then
    say 'restarting dsh-web (pm2)...'
    pm2 restart dsh-web || warn 'pm2 restart failed; restart DSH manually'
  else
    warn 'pm2 not found; restart DSH manually (e.g. pm2 restart dsh-web, or dsh web)'
  fi
else
  say 'next: restart DSH and hard-refresh (Cmd/Ctrl+Shift+R).'
  if command -v pm2 >/dev/null 2>&1; then
    say 'available here: pm2 restart dsh-web (briefly drops the current page session)'
  fi
fi
