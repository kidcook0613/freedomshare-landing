param(
  [Parameter(Mandatory=$true)] [string]$Host,
  [Parameter(Mandatory=$true)] [string]$User,
  [Parameter(Mandatory=$true)] [string]$SshKeyPath,
  [Parameter(Mandatory=$false)] [string]$RemotePath = "/var/www/freedomshare-landing"
)

$ErrorActionPreference = "Stop"

Write-Host "Preparing deployment archive..."
$landingRoot = Split-Path -Parent $PSScriptRoot
$zipPath = Join-Path $env:TEMP "freedomshare-landing.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$exclude = @("node_modules", "storage", ".git")
$files = Get-ChildItem -Path $landingRoot -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path ($files | ForEach-Object { $_.FullName }) -DestinationPath $zipPath

Write-Host "Uploading archive to $User@$Host..."
scp -i $SshKeyPath $zipPath "$User@${Host}:/tmp/freedomshare-landing.zip"

$remoteScript = @"
set -e
sudo mkdir -p $RemotePath
sudo chown -R $User:$User $RemotePath
unzip -o /tmp/freedomshare-landing.zip -d $RemotePath
cd $RemotePath
npm ci --omit=dev
if [ ! -f .env ]; then cp .env.example .env; fi
pm2 start tools/ecosystem.config.cjs --update-env
pm2 save
"@

Write-Host "Running remote install and PM2 start..."
ssh -i $SshKeyPath "$User@$Host" $remoteScript

Write-Host "Deployment complete. Next: configure nginx + SSL on server and set GoDaddy DNS A record to this VPS IP."
