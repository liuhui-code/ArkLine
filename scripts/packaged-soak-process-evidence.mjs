export const WINDOWS_PROCESS_TREE_SCRIPT = `
  $target = [IO.Path]::GetFullPath($env:ARKLINE_SOAK_APPLICATION_PATH)
  $all = @(Get-CimInstance Win32_Process)
  $roots = @($all | Where-Object {
    $_.ExecutablePath -and
    [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target
  })
  $ids = @($roots | Select-Object -ExpandProperty ProcessId)
  do {
    $children = @($all | Where-Object {
      $ids -contains $_.ParentProcessId -and
      $ids -notcontains $_.ProcessId
    } | Select-Object -ExpandProperty ProcessId)
    $ids += $children
  } while ($children.Count -gt 0)
  $items = @(foreach ($item in $all | Where-Object { $ids -contains $_.ProcessId }) {
    $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      [PSCustomObject]@{
        ProcessName = $process.ProcessName
        Id = $process.Id
        ParentProcessId = $item.ParentProcessId
        ExecutablePath = $item.ExecutablePath
        CommandLine = $item.CommandLine
        WorkingSet64 = $process.WorkingSet64
        PrivateMemorySize64 = $process.PrivateMemorySize64
        CPU = $process.CPU
        HandleCount = $process.HandleCount
        ThreadCount = $process.Threads.Count
      }
    }
  })
  $items | ConvertTo-Json -Compress
`;

export function parsePowerShellProcessPayload(payload) {
  if (!payload.trim()) return [];
  const parsed = JSON.parse(payload);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function summarizeProcessEvidence(processes) {
  return {
    processCount: processes.length,
    rssBytes: sum(processes, "WorkingSet64"),
    privateBytes: sum(processes, "PrivateMemorySize64"),
    handleCount: sum(processes, "HandleCount"),
    threadCount: sum(processes, "ThreadCount"),
  };
}

function sum(processes, key) {
  return processes.reduce((total, process) => total + (process[key] ?? 0), 0);
}
