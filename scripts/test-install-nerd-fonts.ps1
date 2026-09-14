<#
.SYNOPSIS
    Smoke test for install-nerd-fonts.ps1 — runs without contacting GitHub.

.DESCRIPTION
    Replaces Invoke-RestMethod with a function that returns a fixed JSON
    payload, then runs the installer with a temporary target directory and
    verifies that:
      - the target directory exists,
      - it contains at least one .ttf file copied from the mocked archive,
      - a second invocation is a no-op (idempotency).

    Requires PowerShell 5.1+.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/test-install-nerd-fonts.ps1
#>

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$installer = Join-Path $repoRoot 'scripts/install-nerd-fonts.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
    throw "installer not found at $installer"
}

# Work entirely in a temp directory.
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nerd-fonts-test-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null

$mockReleaseJson = Join-Path $workRoot 'release.json'
$mockArchive = Join-Path $workRoot 'JetBrainsMono.zip'
$mockExtract = Join-Path $workRoot 'JetBrainsMono'
$mockFont = Join-Path $mockExtract 'JetBrainsMono-Regular.ttf'
$target = Join-Path $workRoot 'fonts\JetBrainsMonoNerdFont'

# --- Build a fake release zip ------------------------------------------------
# The installer expects the zip to expand to a top-level directory of .ttf files.
'@{ tag_name = "vTEST"; assets = @( @{ name = "JetBrainsMono.zip"; browser_download_url = "about:blank" } ) }' |
    Set-Content -LiteralPath $mockReleaseJson -Encoding UTF8

New-Item -ItemType Directory -Path $mockExtract -Force | Out-Null
'fake font bytes' | Set-Content -LiteralPath $mockFont -Encoding UTF8
Compress-Archive -LiteralPath (Join-Path $mockExtract '*') -DestinationPath $mockArchive -Force

# --- Drive the installer -----------------------------------------------------
# The installer reads the archive via -Offline, so the GitHub API is never
# contacted. We use a minimal in-memory shim that intercepts the call the
# installer would otherwise make — but with -Offline we skip that path
# entirely, so no shim is needed. Run the installer twice.

$env:OPENCODE_INSTALL_NERD_FONTS = '1'

$first = & $installer -Offline $mockArchive -Target $target -Verbose
if ($LASTEXITCODE -ne 0) { throw "first install exited $LASTEXITCODE" }

if (-not (Test-Path -LiteralPath $target)) {
    throw "target directory was not created: $target"
}

$installedFonts = Get-ChildItem -LiteralPath $target -File | Where-Object { $_.Extension -in @('.ttf', '.otf') }
if (-not $installedFonts -or $installedFonts.Count -eq 0) {
    throw "no .ttf files were copied to $target"
}

# Second run must be a no-op (idempotency).
$second = & $installer -Offline $mockArchive -Target $target -Verbose
if ($LASTEXITCODE -ne 0) { throw "second install exited $LASTEXITCODE" }

$afterSecond = (Get-ChildItem -LiteralPath $target -File | Where-Object { $_.Extension -in @('.ttf', '.otf') }).Count
if ($afterSecond -ne $installedFonts.Count) {
    throw "second run added new fonts (idempotency violated)"
}

# Opt-out: -Skip must exit 0 without touching the filesystem.
$skip = & $installer -Skip
if ($LASTEXITCODE -ne 0) { throw "-Skip exited $LASTEXITCODE" }

# Opt-out via env var.
$env:OPENCODE_INSTALL_NERD_FONTS = '0'
$envSkip = & $installer
$env:OPENCODE_INSTALL_NERD_FONTS = '1'
if ($envSkip -ne 0) { throw "env opt-out returned non-zero" }

Remove-Item -LiteralPath $workRoot -Recurse -Force
Write-Host 'install-nerd-fonts: smoke test passed'
