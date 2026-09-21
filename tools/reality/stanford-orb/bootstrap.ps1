param(
  [string]$Root = $(if ($env:REALITY_DATA_ROOT) { $env:REALITY_DATA_ROOT } else { Join-Path $env:USERPROFILE ".cache\game-engine-reality\stanford-orb" })
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$ready = Join-Path $Root ".car-subset-v1.ready"
if (Test-Path $ready) {
  Write-Host "Stanford-ORB Car subset already cached at $Root"
  exit 0
}
$archives = Join-Path $Root "_archives"
New-Item -ItemType Directory -Force -Path $archives | Out-Null

function Download-And-Extract([string]$Name,[string]$Url,[scriptblock]$Keep) {
  $archive = Join-Path $archives $Name
  Write-Host "Downloading $Url"
  & curl.exe -L --fail --retry 2 --retry-delay 2 -C - -o $archive $Url
  if ($LASTEXITCODE -ne 0 -and $Url -match '^https://downloads\.cs\.stanford\.edu/') {
    Write-Host "Stanford DNS unavailable; retrying the same HTTPS origin via pinned current A record"
    & curl.exe --resolve "downloads.cs.stanford.edu:443:171.64.64.22" -L --fail --retry 5 --retry-delay 3 -C - -o $archive $Url
  }
  if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url" }
  Write-Host "Indexing $Name"
  $entries = & tar.exe -tzf $archive
  if ($LASTEXITCODE -ne 0) { throw "tar listing failed for $Name" }
  $selected = @($entries | Where-Object $Keep)
  if ($selected.Count -eq 0) { throw "No Stanford Car entries selected from $Name" }
  $list = Join-Path $archives "$Name.files.txt"
  [System.IO.File]::WriteAllLines($list,$selected,[System.Text.Encoding]::ASCII)
  Write-Host "Extracting $($selected.Count) selected entries from $Name"
  & tar.exe -xzf $archive -C $Root -T $list
  if ($LASTEXITCODE -ne 0) { throw "tar extraction failed for $Name" }
  Remove-Item -Force $archive,$list
}

Download-And-Extract "blender_LDR.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/blender_LDR.tar.gz" {
  $_ -match '(^|/)car_scene00(2|4|6)/(transforms_test\.json|test/|test_mask/)'
}
Download-And-Extract "ground_truth.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/ground_truth.tar.gz" {
  ($_ -match '(^|/)car_scene00(2|4|6)/env_map/') -or ($_ -match '(^|/)car_scene004/mesh_blender/')
}

$transforms = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_test.json | Where-Object { $_.FullName -match 'car_scene00(2|4|6)' })
$envs = @(Get-ChildItem -Path $Root -Recurse -Filter *.exr | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]env_map[\\/]' })
$mesh = @(Get-ChildItem -Path $Root -Recurse -Filter mesh.obj | Where-Object { $_.FullName -match 'car_scene004.*mesh_blender' })
if ($transforms.Count -lt 3 -or $envs.Count -lt 3 -or $mesh.Count -lt 1) {
  throw "Incomplete Stanford Car cache: transforms=$($transforms.Count), envs=$($envs.Count), mesh=$($mesh.Count)"
}
Set-Content -Path $ready -Value "Stanford-ORB Car subset v1"
Write-Host "Stanford-ORB Car subset ready: transforms=$($transforms.Count), envs=$($envs.Count), mesh=$($mesh.Count)"
