param(
  [string]$Root = $(if ($env:REALITY_DATA_ROOT) { $env:REALITY_DATA_ROOT } else { Join-Path $env:USERPROFILE ".cache\game-engine-reality\stanford-orb" })
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$ready = Join-Path $Root ".car-subset-v5.ready"

function Test-CarSubset {
  $transforms = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_test.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6)' })
  $envs = @(Get-ChildItem -Path $Root -Recurse -Filter *.exr -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]env_map[\\/]' })
  $mesh = @(Get-ChildItem -Path $Root -Recurse -Filter mesh.obj -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*mesh_blender' })
  $testImages = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test[\\/]' })
  $testMasks = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test_mask[\\/]' })
  $albedo = @(Get-ChildItem -Path $Root -Recurse -Filter *.npy -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*[\\/]pseudo_gt_albedo[\\/]' })
  $depth = @(Get-ChildItem -Path $Root -Recurse -Filter *.npy -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*[\\/]z_depth[\\/]' })
  $complete = $transforms.Count -ge 3 -and $envs.Count -ge 5 -and $mesh.Count -ge 1 -and $testImages.Count -ge 5 -and $testMasks.Count -ge 5
  return [pscustomobject]@{
    Complete=$complete
    Transforms=$transforms.Count
    Envs=$envs.Count
    Mesh=$mesh.Count
    TestImages=$testImages.Count
    TestMasks=$testMasks.Count
    Albedo=$albedo.Count
    Depth=$depth.Count
  }
}

function Write-State([string]$Prefix,$state) {
  Write-Host "$Prefix transforms=$($state.Transforms), envs=$($state.Envs), mesh=$($state.Mesh), images=$($state.TestImages), masks=$($state.TestMasks), albedo=$($state.Albedo), depth=$($state.Depth)"
}

function Extract-GroundTruthExtras([string]$Archive) {
  if (-not (Test-Path $Archive)) { return $false }
  Write-Host "Using local Stanford archive $Archive"
  $entries = & tar.exe -tzf $Archive
  if ($LASTEXITCODE -ne 0) { return $false }
  $selected = @($entries | Where-Object { $_ -match '(^|/)car_scene004/(pseudo_gt_albedo|z_depth)/' })
  if ($selected.Count -eq 0) { return $false }
  $list = Join-Path $Root "_stanford-gt-extra.files.txt"
  [System.IO.File]::WriteAllLines($list,$selected,[System.Text.Encoding]::ASCII)
  & tar.exe -xzf $Archive -C $Root -T $list
  $ok = $LASTEXITCODE -eq 0
  Remove-Item -Force $list -ErrorAction SilentlyContinue
  if ($ok) { Write-Host "Extracted $($selected.Count) pseudo-GT/depth entries" }
  return $ok
}

function Import-LocalGroundTruth {
  $state = Test-CarSubset
  if ($state.Albedo -ge 5 -and $state.Depth -ge 5) { return }

  $roots = @(
    (Join-Path $env:USERPROFILE "Downloads"),
    (Join-Path $env:USERPROFILE "Desktop"),
    (Join-Path $env:USERPROFILE "Documents")
  )

  foreach ($searchRoot in $roots) {
    if (-not (Test-Path $searchRoot)) { continue }
    $scene = @(Get-ChildItem -Path $searchRoot -Recurse -Directory -Filter car_scene004 -ErrorAction SilentlyContinue |
      Where-Object { (Test-Path (Join-Path $_.FullName "pseudo_gt_albedo")) -and (Test-Path (Join-Path $_.FullName "z_depth")) } |
      Select-Object -First 1)
    if ($scene.Count -gt 0) {
      $target = Join-Path $Root "ground_truth\car_scene004"
      New-Item -ItemType Directory -Force -Path $target | Out-Null
      Copy-Item -Force -Recurse (Join-Path $scene[0].FullName "pseudo_gt_albedo") $target
      Copy-Item -Force -Recurse (Join-Path $scene[0].FullName "z_depth") $target
      Write-Host "Imported pseudo-GT/depth from $($scene[0].FullName)"
      return
    }
  }

  $archives = @((Join-Path $Root "_archives\ground_truth.tar.gz"))
  foreach ($searchRoot in $roots) {
    if (-not (Test-Path $searchRoot)) { continue }
    $archives += @(Get-ChildItem -Path $searchRoot -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^ground[_ -]?truth.*\.tar(\.gz)?$' } |
      Select-Object -ExpandProperty FullName)
  }
  foreach ($archive in ($archives | Select-Object -Unique)) {
    if (Extract-GroundTruthExtras $archive) { return }
  }
}

Import-LocalGroundTruth
$state = Test-CarSubset
if (-not $state.Complete) {
  Write-State "Stanford-ORB fast subset incomplete:" $state
  throw "Fast RealityGap requires the existing images/env/mesh subset. CI does not download multi-GB archives."
}

Set-Content -Path $ready -Value "Stanford-ORB Car subset v5"
Write-State "Stanford-ORB Car subset ready:" $state
if ($state.Albedo -lt 5 -or $state.Depth -lt 5) {
  Write-Warning "pseudo_gt_albedo/z_depth not found; RealityGap will use the explicit captured-RGB calibration fallback."
}
