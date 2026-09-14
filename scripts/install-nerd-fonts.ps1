<#
.SYNOPSIS
    Installs JetBrainsMono Nerd Font into the per-user Windows fonts directory.

.DESCRIPTION
    Downloads the latest JetBrainsMono release from the official
    ryanoasis/nerd-fonts GitHub repository (resolved through the GitHub API)
    and unpacks the font files into
    $env:LOCALAPPDATA\Microsoft\Windows\Fonts\JetBrainsMonoNerdFont.

    The script never requires elevation: the destination is inside the
    per-user fonts directory that DirectWrite enumerates without admin rights.

    Exit codes:
        0  Installed successfully, or already present, or skipped.
        1  Non-fatal failure (network, archive, permissions). The OpenCode
           installer treats this as a warning and continues with the rest of
           the configuration.

.PARAMETER Skip
    Skip the install entirely and exit 0.

.PARAMETER Offline
    Path to a previously-downloaded JetBrainsMono.zip archive. Use this when
    the GitHub API is unreachable (rate-limited, blocked) and you already
    have the file locally.

.PARAMETER Target
    Override the destination directory. Defaults to
    $env:LOCALAPPDATA\Microsoft\Windows\Fonts\JetBrainsMonoNerdFont.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/install-nerd-fonts.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/install-nerd-fonts.ps1 -Skip

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/install-nerd-fonts.ps1 -Offline C:\Downloads\JetBrainsMono.zip

.NOTES
    Targets Windows PowerShell 5.1+ and PowerShell 7+. Uses only built-in
    cmdlets (Invoke-RestMethod, Invoke-WebRequest, Expand-Archive).

    Selecting the font inside Windows Terminal / Terminal.app / iTerm2 etc.
    is a manual step and is documented in README.md.
#>

[CmdletBinding()]
param(
    [switch]$Skip,
    [string]$Offline,
    [string]$Target
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---- Opt-out -----------------------------------------------------------------

if ($env:OPENCODE_INSTALL_NERD_FONTS -eq '0') {
    return 0
}

if ($Skip) {
    Write-Verbose 'install-nerd-fonts: -Skip requested, nothing to do'
    return 0
}

# ---- Logging helpers ---------------------------------------------------------

function Write-InstallerLog {
    param([string]$Message)
    Write-Host "install-nerd-fonts: $Message"
}

function Write-InstallerWarn {
    param([string]$Message)
    Write-Warning "install-nerd-fonts: $Message"
}

function Write-InstallerError {
    param([string]$Message)
    Write-Error "install-nerd-fonts: $Message" -ErrorAction Stop
}

# ---- Target directory --------------------------------------------------------

if (-not $Target) {
    if (-not $env:LOCALAPPDATA) {
        Write-InstallerError '$env:LOCALAPPDATA is not set; cannot resolve the per-user fonts directory'
    }
    $Target = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts\JetBrainsMonoNerdFont'
}

Write-InstallerLog "target directory: $Target"

# Idempotency: if any .ttf or .otf is already present, treat as installed.
if (Test-Path -LiteralPath $Target) {
    $existingFonts = Get-ChildItem -LiteralPath $Target -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in @('.ttf', '.otf') }
    if ($existingFonts -and $existingFonts.Count -gt 0) {
        Write-InstallerLog "JetBrainsMono Nerd Font already present in $Target; skipping download"
        return 0
    }
}

# ---- Working directory -------------------------------------------------------

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("nerd-fonts-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$releaseJson = Join-Path $tempRoot 'release.json'
$releaseZip  = Join-Path $tempRoot 'JetBrainsMono.zip'

try {
    if ($Offline) {
        if (-not (Test-Path -LiteralPath $Offline)) {
            Write-InstallerError "-Offline archive not found: $Offline"
        }
        Write-InstallerLog "using offline archive $Offline"
        Copy-Item -LiteralPath $Offline -Destination $releaseZip -Force
    }
    else {
        $apiUrl = 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest'
        Write-InstallerLog "resolving latest JetBrainsMono Nerd Font release from $apiUrl"

        try {
            Invoke-RestMethod -Uri $apiUrl -OutFile $releaseJson -Headers @{ 'User-Agent' = 'opencode-config-installer' }
        }
        catch {
            Write-InstallerError "could not fetch $apiUrl ; re-run with -Offline <archive> once you have the zip locally"
        }

        $release = Get-Content -LiteralPath $releaseJson -Raw | ConvertFrom-Json -ErrorAction Stop
        if (-not $release.tag_name) {
            Write-InstallerError 'GitHub API response did not contain tag_name (rate-limited or blocked?)'
        }

        $asset = $release.assets | Where-Object { $_.name -like 'JetBrainsMono*.zip' } | Select-Object -First 1
        if (-not $asset) {
            Write-InstallerError 'could not locate the JetBrainsMono zip asset in the latest release'
        }

        Write-InstallerLog "downloading $($asset.name)"
        try {
            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $releaseZip -UseBasicParsing
        }
        catch {
            Write-InstallerError "could not download $($asset.browser_download_url)"
        }
    }

    # ---- Extract ------------------------------------------------------------

    $extractRoot = Join-Path $tempRoot 'extracted'
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null

    try {
        Expand-Archive -LiteralPath $releaseZip -DestinationPath $extractRoot -Force
    }
    catch {
        Write-InstallerError "Expand-Archive failed on $releaseZip"
    }

    $innerDirs = Get-ChildItem -LiteralPath $extractRoot -Directory -ErrorAction SilentlyContinue
    if (-not $innerDirs -or $innerDirs.Count -eq 0) {
        Write-InstallerError 'release zip did not contain a top-level directory'
    }
    $fontRoot = $innerDirs[0].FullName

    if (-not (Test-Path -LiteralPath $Target)) {
        New-Item -ItemType Directory -Path $Target -Force | Out-Null
    }

    $fontFiles = Get-ChildItem -LiteralPath $fontRoot -File |
        Where-Object { $_.Extension -in @('.ttf', '.otf') }

    if (-not $fontFiles -or $fontFiles.Count -eq 0) {
        Write-InstallerError 'no .ttf/.otf files found inside the JetBrainsMono zip'
    }

    foreach ($font in $fontFiles) {
        Copy-Item -LiteralPath $font.FullName -Destination $Target -Force
    }

    Write-InstallerLog "JetBrainsMono Nerd Font installed in $Target"
    Write-InstallerLog "select 'JetBrainsMono Nerd Font' in your terminal profile to render the OpenCode TUI icons"
    return 0
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
