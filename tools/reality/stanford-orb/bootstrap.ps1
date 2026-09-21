param(
  [string]$Root = $(if ($env:REALITY_DATA_ROOT) { $env:REALITY_DATA_ROOT } else { Join-Path $env:USERPROFILE ".cache\game-engine-reality\stanford-orb" }),
  [switch]$Download
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$ready = Join-Path $Root ".car-subset-v3.ready"

function Test-CarSubset {
  $transforms = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_test.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6)' })
  $novel = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_novel.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004' })
  $envs = @(Get-ChildItem -Path $Root -Recurse -Filter *.exr -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]env_map[\\/]' })
  $mesh = @(Get-ChildItem -Path $Root -Recurse -Filter mesh.obj -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004.*mesh_blender' })
  $testImages = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test[\\/]' })
  $testMasks = @(Get-ChildItem -Path $Root -Recurse -Filter *.png -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene00(2|4|6).*[\\/]test_mask[\\/]' })
  $complete = $transforms.Count -ge 3 -and $envs.Count -ge 3 -and $mesh.Count -ge 1 -and $testImages.Count -ge 5 -and $testMasks.Count -ge 5
  return [pscustomobject]@{
    Complete=$complete
    Transforms=$transforms.Count
    Novel=$novel.Count
    Envs=$envs.Count
    Mesh=$mesh.Count
    TestImages=$testImages.Count
    TestMasks=$testMasks.Count
  }
}

function Import-LocalNovelTransforms {
  $present = @(Get-ChildItem -Path $Root -Recurse -Filter transforms_novel.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004' })
  if ($present.Count -ge 1) { return }

  foreach ($searchRoot in @((Join-Path $env:USERPROFILE "Downloads"), (Join-Path $env:USERPROFILE "Desktop"))) {
    if (-not (Test-Path $searchRoot)) { continue }
    $loose = @(Get-ChildItem -Path $searchRoot -Recurse -Filter transforms_novel.json -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'car_scene004' } | Select-Object -First 1)
    if ($loose.Count -gt 0) {
      $target = Join-Path $Root "blender_LDR\car_scene004\transforms_novel.json"
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      Copy-Item -Force $loose[0].FullName $target
      Write-Host "Imported Stanford novel poses from $($loose[0].FullName)"
      return
    }
  }

  foreach ($archive in @(
    (Join-Path $Root "_archives\blender_LDR.tar.gz"),
    (Join-Path $env:USERPROFILE "Downloads\blender_LDR.tar.gz"),
    (Join-Path $env:USERPROFILE "Desktop\blender_LDR.tar.gz")
  )) {
    if (-not (Test-Path $archive)) { continue }
    Write-Host "Extracting car_scene004 transforms_novel.json from local archive $archive"
    $entries = & tar.exe -tzf $archive
    if ($LASTEXITCODE -ne 0) { continue }
    $selected = @($entries | Where-Object { $_ -match '(^|/)car_scene004/transforms_novel\.json$' })
    if ($selected.Count -eq 0) { continue }
    $list = Join-Path $Root "_novel-transform.files.txt"
    [System.IO.File]::WriteAllLines($list,$selected,[System.Text.Encoding]::ASCII)
    & tar.exe -xzf $archive -C $Root -T $list
    $ok = $LASTEXITCODE -eq 0
    Remove-Item -Force $list -ErrorAction SilentlyContinue
    if ($ok) { return }
  }
}

function Download-And-Extract([string]$Name,[string]$Url,[scriptblock]$Keep) {
  $archives = Join-Path $Root "_archives"
  New-Item -ItemType Directory -Force -Path $archives | Out-Null
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

Import-LocalNovelTransforms
$existing = Test-CarSubset
if ($existing.Complete) {
  Set-Content -Path $ready -Value "Stanford-ORB Car subset v3"
  Write-Host "Stanford-ORB Car subset already present: transforms=$($existing.Transforms), novel=$($existing.Novel), envs=$($existing.Envs), mesh=$($existing.Mesh), images=$($existing.TestImages), masks=$($existing.TestMasks)"
  exit 0
}
if (Test-Path $ready) { Remove-Item -Force $ready }

if (-not $Download) {
  throw "Stanford-ORB Car fast subset is incomplete at $Root (transforms=$($existing.Transforms), envs=$($existing.Envs), mesh=$($existing.Mesh), images=$($existing.TestImages), masks=$($existing.TestMasks)). Fast RealityGap does not require transforms_novel.json; CI never downloads the multi-GB archives."
}

Download-And-Extract "blender_LDR.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/blender_LDR.tar.gz" {
  ($_ -match '(^|/)car_scene00(2|4|6)/(transforms_test\.json|test/|test_mask/)') -or
  ($_ -match '(^|/)car_scene004/transforms_novel\.json$')
}
Download-And-Extract "ground_truth.tar.gz" "https://downloads.cs.stanford.edu/viscam/StanfordORB/ground_truth.tar.gz" {
  ($_ -match '(^|/)car_scene00(2|4|6)/env_map/') -or
  ($_ -match '(^|/)car_scene004/mesh_blender/')
}

$final = Test-CarSubset
if (-not $final.Complete) {
  throw "Incomplete Stanford Car cache: transforms=$($final.Transforms), novel=$($final.Novel), envs=$($final.Envs), mesh=$($final.Mesh), images=$($final.TestImages), masks=$($final.TestMasks)"
}
Set-Content -Path $ready -Value "Stanford-ORB Car subset v3"
Write-Host "Stanford-ORB Car subset ready: transforms=$($final.Transforms), novel=$($final.Novel), envs=$($final.Envs), mesh=$($final.Mesh), images=$($final.TestImages), masks=$($final.TestMasks)"
