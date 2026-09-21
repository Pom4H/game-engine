param(
  [string]$Root = $(if ($env:REALITY_DATA_ROOT) { $env:REALITY_DATA_ROOT } else { Join-Path $env:USERPROFILE ".cache\game-engine-reality\stanford-orb" }),
  [switch]$Download
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$ready = Join-Path $Root ".car-subset-v4.ready"

function Test-CarSubset {
  $transforms = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_test.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6)' })
  $envs = @(Get-ChildItem -Path $Root -Recurse -Filter *.exr -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]env_map[\\/]' })
  $mesh = @(Get-ChildItem -Path $Root -Recurse -Filter mesh.obj -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*mesh_blender' })
  $testImages = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test[\\/]' })
  $testMasks = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test_mask[\\/]' })
  $albedo = @(Get-ChildItem -Path $Root -Recurse -Filter *.npy -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*[\\/]pseudo_gt_albedo[\\/]' })
  $depth = @(Get-ChildItem -Path $Root -Recurse -Filter *.npy -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*[\\/]z_depth[\\/]' })
  $complete = $transforms.Count -ge 3 -and $envs.Count -ge 5 -and $mesh.Count -ge 1 -and $testImages.Count -ge 5 -and $testMasks.Count -ge 5 -and $albedo.Count -ge 5 -and $depth.Count -ge 5
  return [pscustomobject]@{
    Complete=$complete; Transforms=$transforms.Count; Envs=$envs.Count; Mesh=$mesh.Count
    TestImages=$testImages.Count; TestMasks=$testMasks.Count; Albedo=$albedo.Count; Depth=$depth.Count
  }
}

function Write-State([string]$Prefix,$state) {
  Write-Host "$Prefix transforms=$($state.Transforms), envs=$($state.Envs), mesh=$($state.Mesh), images=$($state.TestImages), masks=$($state.TestMasks), albedo=$($state.Albedo), depth=$($state.Depth)"
}

function Extract-Selected([string]$Archive,[scriptblock]$Keep) {
  if (-not (Test-Path $Archive)) { return $false }
  Write-Host "Using local Stanford archive $Archive"
  $entries = & tar.exe -tzf $Archive
  if ($LASTEXITCODE -ne 0) { return $false }
  $selected = @($entries | Where-Object $Keep)
  if ($selected.Count -eq 0) { return $false }
  $list = Join-Path $Root "_stanford-selected.files.txt"
  [System.IO.File]::WriteAllLines($list,$selected,[System.Text.Encoding]::ASCII)
  & tar.exe -xzf $Archive -C $Root -T $list
  $ok = $LASTEXITCODE -eq 0
  Remove-Item -Force $list -ErrorAction SilentlyContinue
  if ($ok) { Write-Host "Extracted $($selected.Count) files/directories from local archive" }
  return $ok
}

function Import-LocalGroundTruth {
  $state = Test-CarSubset
  if ($state.Albedo -ge 5 -and $state.Depth -ge 5) { return }

  foreach ($searchRoot in @((Join-Path $env:USERPROFILE "Downloads"), (Join-Path $env:USERPROFILE "Desktop"))) {
    if (-not (Test-Path $searchRoot)) { continue }
    $sceneDirs = @(Get-ChildItem -Path $searchRoot -Recurse -Directory -Filter car_scene004 -ErrorAction SilentlyContinue |
      Where-Object { Test-Path (Join-Path $_.FullName "pseudo_gt_albedo") -and Test-Path (Join-Path $_.FullName "z_depth") } |
      Select-Object -First 1)
    if ($sceneDirs.Count -gt 0) {
      $target = Join-Path $Root "ground_truth\car_scene004"
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Copy-Item -Force -Recurse (Join-Path $sceneDirs[0].FullName "pseudo_gt_albedo") $target
      Copy-Item -Force -Recurse (Join-Path $sceneDirs[0].FullName "z_depth") $target
      Write-Host "Imported pseudo GT albedo/depth from $($sceneDirs[0].FullName)"
      return
    }
  }

  foreach ($archive in @(
    (Join-Path $Root "_archives\ground_truth.tar.gz"),
    (Join-Path $env:USERPROFILE "Downloads\ground_truth.tar.gz"),
    (Join-Path $env:USERPROFILE "Desktop\ground_truth.tar.gz")
  )) {
    if (Extract-Selected $archive { $_ -match '(^|/)car_scene004/(pseudo_gt_albedo|z_depth)/' }) { return }
  }
}

function Download-And-Extract([string]$Name,[string]$Url,[scriptblock]$Keep) {
  $archives = Join-Path $Root "_archives"; New-Item -ItemType Directory -Force -Path $archives | Out-Null
  $archive = Join-Path $archives $Name
  & curl.exe -L --fail --retry 2 --retry-delay 2 -C - -o $archive $Url
  if ($LASTEXITCODE -ne 0 -and $Url -match '^https://downloads\.cs\.stanford\.edu/') {
    & curl.exe --resolve "downloads.cs.stanford.edu:443:171.64.64.22" -L --fail --retry 5 --retry-delay 3 -C - -o $archive $Url
  }
  if ($LASTEXITCODE -ne 0) { throw "curl failed for $Url" }
  if (-not (Extract-Selected $archive $Keep)) { throw "Could not extract selected Stanford data from $archive" }
  Remove-Item -Force $archive -ErrorAction SilentlyContinue
}

Import-LocalGroundTruth
$existing = Test-CarSubset
if ($existing.Complete) {
  Set-Content -Path $ready -Value "Stanford-ORB Car subset v4"
  Write-State "Stanford-ORB Car subset ready:" $existing
  exit 0
}
if (Test-Path $ready) { Remove-Item -Force $ready }

if (-not $Download) {
  Write-State "Stanford-ORB cache incomplete:" $existing
  throw "Fast RealityGap requires scene004 pseudo_gt_albedo and z_depth in addition to the existing images/env/mesh. Put the extracted ground_truth archive under Downloads/Desktop or the cache; CI will not download multi-GB archives."
}

if ($existing.Transforms -lt 3 -or $existing.TestImages -lt 5 -or $existing.TestMasks -lt 5) {
  Download-And-Extract "blender_LDR.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/blender_LDR.tar.gz" {
    $_ -match '(^|/)car_scene00(2|4|6)/(transforms_test\.json|test/|test_mask/)'
  }
}
Download-And-Extract "ground_truth.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/ground_truth.tar.gz" {
  ($_ -match '(^|/)car_scene00(2|4|6)/env_map/') -or
  ($_ -match '(^|/)car_scene004/(mesh_blender|pseudo_gt_albedo|z_depth)/')
}

$final = Test-CarSubset
if (-not $final.Complete) { Write-State "Stanford-ORB cache still incomplete:" $final; throw "Incomplete Stanford Car cache" }
Set-Content -Path $ready -Value "Stanford-ORB Car subset v4"
Write-State "Stanford-ORB Car subset ready:" $final
