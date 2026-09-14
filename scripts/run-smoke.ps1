$ErrorActionPreference = 'Stop'

$secureKey = $null
$keyPointer = [IntPtr]::Zero
$plainKey = $null
$process = $null
$processStarted = $false

try {
  $secureKey = Read-Host 'Thordata API key' -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)

  $nodeCommand = Get-Command node -ErrorAction Stop
  $nodePath = $nodeCommand.Source
  if ([string]::IsNullOrWhiteSpace($nodePath)) {
    throw 'Node executable was not found'
  }

  $smokeScript = Join-Path $PSScriptRoot 'smoke-serp.js'
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $nodePath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $argumentListProperty = $startInfo.GetType().GetProperty('ArgumentList')
  if ($argumentListProperty) {
    [void]$startInfo.ArgumentList.Add($smokeScript)
  } else {
    $startInfo.Arguments = '"' + $smokeScript.Replace('"', '\"') + '"'
  }

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Unable to start Node smoke test'
  }
  $processStarted = $true

  [void]$process.StandardInput.WriteLine($plainKey)
  $process.StandardInput.Close()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $null = $stderrTask.GetAwaiter().GetResult()

  $sanitized = $stdout.Trim()
  try {
    $parsed = $sanitized | ConvertFrom-Json
    $safe = [ordered]@{
      ok = [bool]$parsed.ok
      httpStatus = if ($null -eq $parsed.httpStatus) { $null } else { [int]$parsed.httpStatus }
      engine = 'google'
      hasResult = [bool]$parsed.hasResult
      hasTaskId = [bool]$parsed.hasTaskId
    }
    Write-Output ($safe | ConvertTo-Json -Compress)
  } catch {
    Write-Output '{"ok":false,"httpStatus":null,"engine":"google","hasResult":false,"hasTaskId":false}'
  }

  if ($process.ExitCode -ne 0) {
    [Console]::Error.WriteLine('Smoke test failed')
    exit $process.ExitCode
  }
} catch {
  [Console]::Error.WriteLine('Smoke test failed')
  exit 1
} finally {
  if ($processStarted -and $process -and -not $process.HasExited) {
    try {
      $process.Kill()
    } catch [InvalidOperationException] {
    } catch [System.ComponentModel.Win32Exception] {
    }
  }
  if ($process) {
    $process.Dispose()
  }
  $plainKey = $null
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
  if ($secureKey) {
    $secureKey.Dispose()
  }
}
