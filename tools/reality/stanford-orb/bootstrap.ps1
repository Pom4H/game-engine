param(
  [string]$Root = $(if ($env:REALITY_DATA_ROOT) { $env:REALITY_DATA_ROOT } else { Join-Path $env:USERPROFILE ".cache\game-engine-reality\stanford-orb" }),
  [switch]$Download
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$ready = Join-Path $Root ".car-subset-v1.ready"

function Test-CarSubset {
  $transforms = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_test.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6)' })
  $envs = @(Get-ChildItem -Path $Root -Recurse -Filter *.exr -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]env_map[\\/]' })
  $mesh = @(Get-ChildItem -Path $Root -Recurse -Filter mesh.obj -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*mesh_blender' })
  $testImages = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test[\\/]' })
  $testMasks = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test_mask[\\/]' })
  $complete = $transforms.Count -ge 3 -and $envs.Count -ge 3 -and $mesh.Count -ge 1 -and $testImages.Count -ge 3 -and $testMasks.Count -ge 3
  return [pscustomobject]@{
    Complete=$complete
    Transforms=$transforms.Count
    Envs=$envs.Count
    Mesh=$mesh.Count
    TestImages=$testImages.Count
    TestMasks=$testMasks.Count
  }
}

$existing = Test-CarSubset
if ($existing.Complete) {
  Set-Content -Path $ready -Value "Stanford-ORB Car subset v1"
  Write-Host "Stanford-ORB Car subset already present: transforms=$($existing.Transforms), envs=$($existing.Envs), mesh=$($existing.Mesh), images=$($existing.TestImages), masks=$($existing.TestMasks)"
  exit 0
}
if (Test-Path $ready) { Remove-Item -Force $ready }

if (-not $Download) {
  throw "Stanford-ORB Car subset is not installed at $Root. Extract car_scene002/004/006 from blender_LDR and ground_truth there. CI never downloads the multi-GB archives."
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

$final = Test-CarSubset
if (-not $final.Complete) {
  throw "Incomplete Stanford Car cache: transforms=$($final.Transforms), envs=$($final.Envs), mesh=$($final.Mesh), images=$($final.TestImages), masks=$($final.TestMasks)"
}
Set-Content -Path $ready -Value "Stanford-ORB Car subset v1"
Write-Host "Stanford-ORB Car subset ready: transforms=$($final.Transforms), envs=$($final.Envs), mesh=$($final.Mesh), images=$($final.TestImages), masks=$($final.TestMasks)"
