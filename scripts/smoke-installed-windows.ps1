[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw 'The installed-package smoke test requires Windows.'
}

$workspace = (Resolve-Path -LiteralPath '.').Path
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$workspacePrefix = $workspace.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
  [System.IO.Path]::DirectorySeparatorChar
if (
  $output.Equals($workspace, [System.StringComparison]::OrdinalIgnoreCase) -or
  $output.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)
) {
  throw "The installed smoke directory must be outside the development checkout: $output"
}
if (Test-Path -LiteralPath $output) {
  throw "Refusing to overwrite an existing smoke directory: $output"
}

$installDirectory = Join-Path $output 'Installed Application'
$runtimeDirectory = Join-Path $output 'Runtime Data'
New-Item -ItemType Directory -Path $installDirectory, $runtimeDirectory | Out-Null

$installerArguments = @{
  FilePath = $installer
  ArgumentList = "/S /D=$installDirectory"
  PassThru = $true
  Wait = $true
}
$installerProcess = Start-Process @installerArguments
if ($installerProcess.ExitCode -ne 0) {
  throw "NSIS installer exited with code $($installerProcess.ExitCode)."
}

$sidecarPath = Join-Path $installDirectory 'verify-engine.exe'
$applicationPath = Join-Path $installDirectory 'local-code-verifier.exe'
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
  throw "The installed bundle does not contain the expected sidecar: $sidecarPath"
}
if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
  throw "The installed desktop executable was not found at $applicationPath."
}
$sidecar = Get-Item -LiteralPath $sidecarPath
$application = Get-Item -LiteralPath $applicationPath

$node = (Get-Command node.exe -ErrorAction Stop).Source
$git = (Get-Command git.exe -ErrorAction Stop).Source
$windowsPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$engineSmoke = Join-Path $workspace 'apps/cli/scripts/smoke-windows-sea.mjs'
$uiSmoke = Join-Path $workspace 'scripts/smoke-installed-ui.mjs'
$previousEnginePath = $env:VERIFY_ENGINE_PATH
try {
  $env:VERIFY_ENGINE_PATH = $sidecar.FullName
  & $node $engineSmoke
  if ($LASTEXITCODE -ne 0) {
    throw "Installed engine smoke exited with code $LASTEXITCODE."
  }
} finally {
  if ($null -eq $previousEnginePath) {
    Remove-Item Env:VERIFY_ENGINE_PATH -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_ENGINE_PATH = $previousEnginePath
  }
}

$previousPath = $env:PATH
$previousLocalAppData = $env:LOCALAPPDATA
$previousDatabasePath = $env:VERIFY_DATABASE_PATH
$previousWebViewArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousWebViewUserData = $env:WEBVIEW2_USER_DATA_FOLDER
$previousEngineCommand = $env:VERIFY_ENGINE_COMMAND
$previousEngineArguments = $env:VERIFY_ENGINE_ARGS_JSON
$previousGuiEnginePath = $env:VERIFY_ENGINE_PATH
$previousInstalledEnginePath = $env:VERIFY_INSTALLED_ENGINE_PATH
$previousSmokeDebugPort = $env:VERIFY_SMOKE_DEBUG_PORT
$previousSmokeGitPath = $env:VERIFY_SMOKE_GIT_PATH
$previousSmokeRoot = $env:VERIFY_SMOKE_ROOT
$previousSmokeMode = $env:VERIFY_SMOKE_MODE
$previousRestartRepository = $env:VERIFY_SMOKE_RESTART_REPOSITORY
$guiProcess = $null
$uiSmokeRoot = Join-Path $output ("Installed UI Workflow {0}" -f [char]0x00FC)
$webViewPolicyEdgePath = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
$webViewPolicyWebView2Path = Join-Path $webViewPolicyEdgePath 'WebView2'
$webViewPolicyPath = Join-Path $webViewPolicyWebView2Path 'AdditionalBrowserArguments'
$webViewPolicyValueName = $application.Name
$currentPrincipal = [System.Security.Principal.WindowsPrincipal]::new(
  [System.Security.Principal.WindowsIdentity]::GetCurrent()
)
$isElevated = $currentPrincipal.IsInRole(
  [System.Security.Principal.WindowsBuiltInRole]::Administrator
)
$webViewPolicyEdgeKeyExisted = $false
$webViewPolicyWebView2KeyExisted = $false
$webViewPolicyKeyExisted = $false
$webViewPolicyValueExisted = $false
$previousWebViewPolicyValue = $null
$previousWebViewPolicyKind = $null
$webViewPolicyTouched = $false

if ($isElevated) {
  $webViewPolicyEdgeKeyExisted = Test-Path -LiteralPath $webViewPolicyEdgePath
  $webViewPolicyWebView2KeyExisted = Test-Path -LiteralPath $webViewPolicyWebView2Path
  $webViewPolicyKeyExisted = Test-Path -LiteralPath $webViewPolicyPath
  if ($webViewPolicyKeyExisted) {
    $policyKey = Get-Item -LiteralPath $webViewPolicyPath
    if ($policyKey.GetValueNames() -contains $webViewPolicyValueName) {
      $webViewPolicyValueExisted = $true
      $previousWebViewPolicyValue = $policyKey.GetValue(
        $webViewPolicyValueName,
        $null,
        [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
      )
      $previousWebViewPolicyKind = $policyKey.GetValueKind($webViewPolicyValueName).ToString()
    }
  }
}

function Get-SmokeDebugPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Stop-SmokeApplication {
  param([System.Diagnostics.Process]$Process)

  if ($null -eq $Process -or $Process.HasExited) {
    return
  }
  $null = $Process.CloseMainWindow()
  if (-not $Process.WaitForExit(5000)) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit()
  }
}

function Set-SmokeWebViewArguments {
  param([int]$Port)

  $arguments = "--remote-debugging-port=$Port --remote-allow-origins=*"
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $arguments
  if (-not $isElevated) {
    return
  }

  $policyPaths = @(
    $webViewPolicyEdgePath
    $webViewPolicyWebView2Path
    $webViewPolicyPath
  )
  foreach ($policyPath in $policyPaths) {
    if (-not (Test-Path -LiteralPath $policyPath)) {
      New-Item -Path $policyPath -Force | Out-Null
    }
  }
  New-ItemProperty `
    -LiteralPath $webViewPolicyPath `
    -Name $webViewPolicyValueName `
    -Value $arguments `
    -PropertyType String `
    -Force | Out-Null
}

function Restore-SmokeWebViewPolicy {
  if (-not $webViewPolicyTouched) {
    return
  }

  if ($webViewPolicyValueExisted) {
    New-ItemProperty `
      -LiteralPath $webViewPolicyPath `
      -Name $webViewPolicyValueName `
      -Value $previousWebViewPolicyValue `
      -PropertyType $previousWebViewPolicyKind `
      -Force | Out-Null
  } else {
    Remove-ItemProperty `
      -LiteralPath $webViewPolicyPath `
      -Name $webViewPolicyValueName `
      -ErrorAction SilentlyContinue
  }

  $cleanupPaths = @(
    @{ Path = $webViewPolicyPath; Existed = $webViewPolicyKeyExisted }
    @{ Path = $webViewPolicyWebView2Path; Existed = $webViewPolicyWebView2KeyExisted }
    @{ Path = $webViewPolicyEdgePath; Existed = $webViewPolicyEdgeKeyExisted }
  )
  foreach ($candidate in $cleanupPaths) {
    if (-not $candidate.Existed -and (Test-Path -LiteralPath $candidate.Path)) {
      $policyKey = Get-Item -LiteralPath $candidate.Path
      if ($policyKey.ValueCount -eq 0 -and $policyKey.SubKeyCount -eq 0) {
        Remove-Item -LiteralPath $candidate.Path
      }
    }
  }
}

try {
  $systemRoot = $env:SystemRoot
  $env:PATH = @(
    "$systemRoot\System32"
    $systemRoot
    "$systemRoot\System32\Wbem"
    (Split-Path -Parent $windowsPowerShell)
    (Split-Path -Parent $git)
  ) -join ';'
  $env:VERIFY_DATABASE_PATH = Join-Path $runtimeDirectory 'history.sqlite3'
  $env:LOCALAPPDATA = Join-Path $runtimeDirectory 'LocalAppData'
  $env:VERIFY_ENGINE_COMMAND = 'Z:\checkout-path-must-not-be-used\node.exe'
  $env:VERIFY_ENGINE_ARGS_JSON = 'not valid JSON and must be ignored by release builds'
  $env:VERIFY_ENGINE_PATH = 'Z:\checkout-path-must-not-be-used\verify-engine.exe'
  $env:VERIFY_INSTALLED_ENGINE_PATH = $sidecar.FullName
  $debugPort = Get-SmokeDebugPort
  $env:VERIFY_SMOKE_DEBUG_PORT = [string]$debugPort
  $env:VERIFY_SMOKE_GIT_PATH = $git
  $env:VERIFY_SMOKE_ROOT = $uiSmokeRoot
  $env:VERIFY_SMOKE_MODE = 'primary'
  Remove-Item Env:VERIFY_SMOKE_RESTART_REPOSITORY -ErrorAction SilentlyContinue
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $output 'WebView2 User Data'
  if ($isElevated) {
    $webViewPolicyTouched = $true
  }
  Set-SmokeWebViewArguments -Port $debugPort
  if ($null -ne (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js unexpectedly remains available on the packaged-app smoke PATH.'
  }

  $guiProcess = Start-Process -FilePath $application.FullName -WorkingDirectory $installDirectory -PassThru
  & $node $uiSmoke
  if ($LASTEXITCODE -ne 0) {
    throw "Installed UI workflow smoke exited with code $LASTEXITCODE."
  }

  $guiProcess.Refresh()
  if ($guiProcess.HasExited) {
    throw "The installed desktop app exited during workflow smoke with code $($guiProcess.ExitCode)."
  }

  Stop-SmokeApplication -Process $guiProcess
  $guiProcess = $null

  $debugPort = Get-SmokeDebugPort
  $env:VERIFY_SMOKE_DEBUG_PORT = [string]$debugPort
  $env:VERIFY_SMOKE_MODE = 'restart'
  $env:VERIFY_SMOKE_RESTART_REPOSITORY =
    Join-Path $uiSmokeRoot ("PASS repository {0}" -f [char]0x00FC)
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $output 'WebView2 Restart User Data'
  Set-SmokeWebViewArguments -Port $debugPort

  $guiProcess = Start-Process -FilePath $application.FullName -WorkingDirectory $installDirectory -PassThru
  & $node $uiSmoke
  if ($LASTEXITCODE -ne 0) {
    throw "Installed UI restart smoke exited with code $LASTEXITCODE."
  }

  $guiProcess.Refresh()
  if ($guiProcess.HasExited) {
    throw "The installed desktop app exited during restart smoke with code $($guiProcess.ExitCode)."
  }

  $sidecarExitDeadline = [System.DateTime]::UtcNow.AddSeconds(15)
  do {
    $remainingSidecars = @(
      Get-Process -Name 'verify-engine' -ErrorAction SilentlyContinue |
        Where-Object {
          try {
            $_.Path.StartsWith($installDirectory, [System.StringComparison]::OrdinalIgnoreCase)
          } catch {
            $false
          }
        }
    )
    if ($remainingSidecars.Count -eq 0) {
      break
    }
    Start-Sleep -Milliseconds 200
  } while ([System.DateTime]::UtcNow -lt $sidecarExitDeadline)
  if ($remainingSidecars.Count -gt 0) {
    throw "Installed verification sidecars remain after bounded restart shutdown: $($remainingSidecars.Id -join ', ')."
  }
} finally {
  $env:PATH = $previousPath
  if ($null -eq $previousLocalAppData) {
    Remove-Item Env:LOCALAPPDATA -ErrorAction SilentlyContinue
  } else {
    $env:LOCALAPPDATA = $previousLocalAppData
  }
  if ($null -eq $previousDatabasePath) {
    Remove-Item Env:VERIFY_DATABASE_PATH -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_DATABASE_PATH = $previousDatabasePath
  }
  if ($null -eq $previousWebViewArguments) {
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
  } else {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousWebViewArguments
  }
  if ($null -eq $previousWebViewUserData) {
    Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  } else {
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousWebViewUserData
  }
  if ($null -eq $previousEngineCommand) {
    Remove-Item Env:VERIFY_ENGINE_COMMAND -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_ENGINE_COMMAND = $previousEngineCommand
  }
  if ($null -eq $previousEngineArguments) {
    Remove-Item Env:VERIFY_ENGINE_ARGS_JSON -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_ENGINE_ARGS_JSON = $previousEngineArguments
  }
  if ($null -eq $previousGuiEnginePath) {
    Remove-Item Env:VERIFY_ENGINE_PATH -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_ENGINE_PATH = $previousGuiEnginePath
  }
  if ($null -eq $previousInstalledEnginePath) {
    Remove-Item Env:VERIFY_INSTALLED_ENGINE_PATH -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_INSTALLED_ENGINE_PATH = $previousInstalledEnginePath
  }
  if ($null -eq $previousSmokeDebugPort) {
    Remove-Item Env:VERIFY_SMOKE_DEBUG_PORT -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_SMOKE_DEBUG_PORT = $previousSmokeDebugPort
  }
  if ($null -eq $previousSmokeGitPath) {
    Remove-Item Env:VERIFY_SMOKE_GIT_PATH -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_SMOKE_GIT_PATH = $previousSmokeGitPath
  }
  if ($null -eq $previousSmokeRoot) {
    Remove-Item Env:VERIFY_SMOKE_ROOT -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_SMOKE_ROOT = $previousSmokeRoot
  }
  if ($null -eq $previousSmokeMode) {
    Remove-Item Env:VERIFY_SMOKE_MODE -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_SMOKE_MODE = $previousSmokeMode
  }
  if ($null -eq $previousRestartRepository) {
    Remove-Item Env:VERIFY_SMOKE_RESTART_REPOSITORY -ErrorAction SilentlyContinue
  } else {
    $env:VERIFY_SMOKE_RESTART_REPOSITORY = $previousRestartRepository
  }
  try {
    Stop-SmokeApplication -Process $guiProcess
  } finally {
    Restore-SmokeWebViewPolicy
  }
}

$summary = [ordered]@{
  installer = $installer
  installDirectory = $installDirectory
  application = $application.FullName
  sidecar = $sidecar.FullName
  engineSmoke = 'passed'
  guiLaunchWithoutNodeOnPath = 'passed'
  fullGuiWorkflow = 'passed through the installed WebView and native IPC bridge'
  uiWorkflowSummary = Join-Path $uiSmokeRoot 'ui-summary.json'
  restartWorkflowSummary = Join-Path $uiSmokeRoot 'restart-summary.json'
  runHistoryAfterAppRestart = 'passed'
  persistedCancellation = 'passed'
  recordedProcessCleanup = 'passed'
}
$summary | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'summary.json') -Encoding utf8
Write-Host "Installed-package smoke passed. Summary: $(Join-Path $output 'summary.json')"
