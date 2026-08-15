# =============================================================================
# dsh-ui-gitworkbench one-shot installer (official CLI path; pwsh 7 / PS 5.1)
#
# Installs the npm package and mounts it through the official plugin command:
#   dsh plugin --profile web add @young1lin/dsh-ui-gitworkbench@<version>
#
# The package declares dsh.bundle.patch (cordis.patch.yml), so the CLI's bundle
# coordination registers it into the profile's dsh.profile.bundles and mounts
# the host half on next start -- no manual cordis.patch.yml mount entry.
#
# Usage:
#   irm https://raw.githubusercontent.com/young1lin/dsh-ui-gitworkbench/main/scripts/install.ps1 | iex
#   & ([scriptblock]::Create((irm '<raw url>'))) -Version 0.1.0 -Restart
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
#
# Parameters:
#   -Version    npm version/range; default latest (resolved against the registry).
#   -Restart    After install, try `pm2 restart dsh-web` (hint only when pm2 is absent).
#   -DryRun     Print the planned steps, write nothing.
#
# Environment (all optional):
#   DSH_HOME    default %USERPROFILE%\.dsh
#   REGISTRY    default https://registry.npmjs.org
#   DSH_CMD     default: dsh on PATH, else npx -y --package @deepseek-ai/dsh
#
# Notes:
# - pnpm 11 minimumReleaseAge rejects versions published <24h ago. The script
#   pre-writes minimumReleaseAgeExclude for this package (idempotent) so a
#   fresh release installs on first try.
# - Older installs used a manual link: dependency + cordis.patch.yml mount
#   entry. The script removes both idempotently (double mounting = two host
#   halves and two chips).
# =============================================================================
param(
  [string]$Version = '',
  [switch]$Restart,
  [switch]$DryRun
)

$PKG = '@young1lin/dsh-ui-gitworkbench'
$REGISTRY = if ($env:REGISTRY) { $env:REGISTRY } else { 'https://registry.npmjs.org' }

if ($env:DSH_HOME) {
  $DSH_HOME = $env:DSH_HOME
} elseif ($env:USERPROFILE) {
  $DSH_HOME = Join-Path $env:USERPROFILE '.dsh'
} else {
  $DSH_HOME = Join-Path $HOME '.dsh'
}
$PROFILE_DIR = Join-Path $DSH_HOME 'profiles\web'
$WS_YML = Join-Path $PROFILE_DIR 'pnpm-workspace.yaml'
$PATCH_YML = Join-Path $PROFILE_DIR 'cordis.patch.yml'

function Say([string]$m)  { Write-Host "[install] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[warn] $m" -ForegroundColor Yellow }
function Die([string]$m)  { Write-Host "[error] $m" -ForegroundColor Red; exit 1 }

function Resolve-Spec {
  param([string]$Given)
  if ([string]::IsNullOrWhiteSpace($Given) -or $Given -eq 'latest') {
    # Accept only exit-code-0 output that looks like a version: on a 404 the
    # registry query fails, and PS 5.1 can wrap stderr remnants (e.g. a
    # help-remedy line) into the captured pipeline -- a truthiness check once
    # resolved "latest" to the garbage string "npm help".
    foreach ($tool in @('npm', 'pnpm')) {
      if (Get-Command $tool -ErrorAction SilentlyContinue) {
        $raw = & $tool view $PKG version "--registry=$REGISTRY" 2>$null
        if ($LASTEXITCODE -eq 0) {
          $v = ([string]($raw | Select-Object -Last 1)).Trim()
          if ($v -match '^\d+\.\d+\.\d+') { return $v }
        }
      }
    }
    Warn 'Cannot resolve latest version (npm/pnpm query failed); falling back to latest.'
    Warn 'If you know the version, pass it explicitly: -Version 0.1.0'
    return 'latest'
  }
  return $Given
}

function Get-DshCli {
  if ($env:DSH_CMD) { return $env:DSH_CMD }
  if (Get-Command dsh -ErrorAction SilentlyContinue) { return 'dsh' }
  if (Get-Command npx -ErrorAction SilentlyContinue) { return 'npx' }
  return $null
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die 'node not found (DSH needs Node.js >= 20). Install Node.js first.'
}
if (-not (Test-Path $PROFILE_DIR)) {
  Die "Profile directory not found: $PROFILE_DIR (run dsh web once first)"
}
if (-not (Test-Path $WS_YML)) {
  Die "$WS_YML not found (initialize the web profile first)"
}

$SPEC = Resolve-Spec $Version
$CLI = Get-DshCli
if (-not $CLI) {
  Die 'Neither dsh nor npx found. Install DSH (and Node/npm), or set DSH_CMD.'
}
$cliDisplay = if ($CLI -eq 'npx') { 'npx -y --package @deepseek-ai/dsh dsh' } else { $CLI }
Say "Target: $cliDisplay plugin --profile web add $PKG@$SPEC (profile: $PROFILE_DIR)"

if ($DryRun) {
  Say "[dry-run] step 1: ensure $WS_YML has minimumReleaseAgeExclude ($PKG)"
  Say "[dry-run] step 2: run $CLI plugin --profile web add $PKG@$SPEC (install + bundle registration)"
  Say "[dry-run] step 3: verify dsh.profile.bundles contains $PKG"
  Say "[dry-run] step 4: idempotently drop the old manual gitworkbench mount entry in $PATCH_YML (if any)"
  if ($Restart) { Say '[dry-run] step 5: pm2 restart dsh-web' } else { Say '[dry-run] step 5: prompt for manual DSH restart' }
  exit 0
}

# Step 1: pre-write workspace settings (idempotent) so pnpm 11 accepts a
# version published less than 24h ago.
$wsScript = @'
const fs = require("fs");
const p = process.argv[2];
const pkg = process.argv[3];
let t = fs.readFileSync(p, "utf8");
const before = t;
if (!new RegExp("^\\s*-\\s+" + pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m").test(t)) {
  if (/^\s*minimumReleaseAgeExclude:\s*$/m.test(t)) {
    t = t.replace(/^(\s*minimumReleaseAgeExclude:\s*)$/m, "$1\n  - " + pkg);
  } else {
    t += "\nminimumReleaseAgeExclude:\n  - " + pkg + "\n";
  }
}
if (t !== before) fs.writeFileSync(p, t);
console.log(t === before ? "unchanged" : "updated");
'@
# PS 5.1 mangles embedded double quotes when a multi-line script is passed to
# `node -e` through the Windows command line; a temp file sidesteps that.
$wsJs = Join-Path $env:TEMP ("dshgw-ws-" + [guid]::NewGuid().ToString("N") + ".js")
Set-Content -LiteralPath $wsJs -Value $wsScript -Encoding UTF8
$wsOut = node $wsJs "$WS_YML" "$PKG" 2>&1
$wsCode = $LASTEXITCODE
Remove-Item -LiteralPath $wsJs -Force -ErrorAction SilentlyContinue
$wsResult = (($wsOut | Out-String)).Trim()
if ($wsCode -ne 0) { Die "Failed to update $WS_YML (node exit $wsCode): $wsResult" }
if ($wsResult -eq 'updated') {
  Say "Ensured ${WS_YML}: minimumReleaseAgeExclude ($PKG)"
} else {
  Say 'Workspace settings already fine, skipped'
}

# Step 2: official CLI install + bundle registration (mount included)
if ($CLI -eq 'dsh') {
  $cliArgs = @('plugin', '--profile', 'web', 'add', "$PKG@$SPEC")
} else {
  $cliArgs = @('-y', '--package', '@deepseek-ai/dsh', 'dsh', 'plugin', '--profile', 'web', 'add', "$PKG@$SPEC")
}
Say "Running $cliDisplay plugin --profile web add $PKG@$SPEC ..."
$addOut = & $CLI @cliArgs 2>&1
$addCode = $LASTEXITCODE
$addOut | ForEach-Object { $_ }
if ($addCode -ne 0) {
  Warn 'dsh plugin add failed. Likely causes:'
  Warn '  - network/auth: npm registry unreachable or auth required.'
  Warn "  - dependency conflict: retry manually: cd $PROFILE_DIR; pnpm install"
  exit 1
}

# Step 3: verify the bundle got registered (the sign mounting took effect)
$pkgJson = Get-Content -Raw (Join-Path $PROFILE_DIR 'package.json') | ConvertFrom-Json
$bundles = $pkgJson.dsh.profile.bundles
if ($bundles -notcontains $PKG) {
  Warn "$PKG missing from dsh.profile.bundles -- bundle registration failed."
  exit 1
}
Say "Bundle registered: dsh.profile.bundles contains $PKG (mounts on next start)"

# Step 4: idempotently remove an old manual mount entry (double-mount guard)
if (Test-Path $PATCH_YML) {
  $mountScript = @'
const fs = require("fs");
const p = process.argv[2];
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
    if (block.some((l) => /id:\s*ui-gitworkbench\b/.test(l) || /name:\s*'\@young1lin\/dsh-ui-gitworkbench'/.test(l))) {
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
'@
  $mountJs = Join-Path $env:TEMP ("dshgw-mount-" + [guid]::NewGuid().ToString("N") + ".js")
  Set-Content -LiteralPath $mountJs -Value $mountScript -Encoding UTF8
  $mountOut = node $mountJs "$PATCH_YML" 2>&1
  $mountCode = $LASTEXITCODE
  Remove-Item -LiteralPath $mountJs -Force -ErrorAction SilentlyContinue
  $mountResult = (($mountOut | Out-String)).Trim()
  if ($mountCode -ne 0) { Die "Failed to update $PATCH_YML (node exit $mountCode): $mountResult" }
  if ($mountResult -eq 'removed') {
    Say "Removed the old manual gitworkbench mount entry from $PATCH_YML (bundle channel takes over)"
  } else {
    Say 'No stale manual mount entry, skipped'
  }
}

Say "Install complete: $PKG@$SPEC"

# Step 5: restart guidance
if ($Restart) {
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say 'Restarting dsh-web (pm2)...'
    pm2 restart dsh-web
    if ($LASTEXITCODE -ne 0) { Warn 'pm2 restart failed; restart DSH manually' }
  } else {
    Warn 'pm2 not found; restart DSH manually (e.g. pm2 restart dsh-web, or dsh web)'
  }
} else {
  Say 'Next: restart DSH and hard-refresh (Ctrl+Shift+R / Cmd+Shift+R).'
  if (Get-Command pm2 -ErrorAction SilentlyContinue) {
    Say 'Available here: pm2 restart dsh-web (briefly drops the current page session)'
  }
}
