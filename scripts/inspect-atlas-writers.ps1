# Read-only: no process/service/network configuration is changed.
param([switch]$IncludePublicIp)
$inventory = @(Get-CimInstance Win32_Process)
$connections = @(Get-NetTCPConnection -State Established -ErrorAction Stop |
    Where-Object { $_.RemotePort -eq 27017 })
$owners = @($connections.OwningProcess | Sort-Object -Unique)
$parents = @($inventory | Where-Object { $_.ProcessId -in $owners } | Select-Object -ExpandProperty ParentProcessId)
$result = [ordered]@{
    Computer = $env:COMPUTERNAME
    TimeUTC = (Get-Date).ToUniversalTime().ToString('o')
    PublicIP = $null
    Processes = @($inventory | Where-Object { $_.ProcessId -in ($owners + $parents) } | ForEach-Object {
        [ordered]@{
            PID = $_.ProcessId
            ParentPID = $_.ParentProcessId
            Process = $_.Name
            Started = $_.CreationDate
            DiscoveryWatch = ($_.CommandLine -match 'job-engine[\\/]cli\.(ts|js|mjs)' -and $_.CommandLine -match '(?<![\w-])watch(?![\w-])')
            SemanticWatch = $_.CommandLine -match 'watch-semantic'
            MatchingIndex = $_.CommandLine -match '(src|dist)[\\/]matching-index\.(ts|js)'
            Launcher = $_.CommandLine -match 'start-with-discovery\.mjs'
            ApiEntry = $_.CommandLine -match '(src|dist)[\\/]index\.(ts|js)'
            QueueWorker = $_.CommandLine -match '(src|dist)[\\/]workers[\\/](index|module2)\.(ts|js)'
        }
    })
    Connections = @($connections | Select-Object OwningProcess, RemoteAddress, RemotePort)
    Services = @(Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -in ($owners + $parents) -and $_.ProcessId -ne 0 } | Select-Object Name, State, ProcessId)
}
if ($IncludePublicIp) { $result.PublicIP = (Invoke-RestMethod -Uri 'https://checkip.amazonaws.com' -TimeoutSec 10).Trim() }
$result | ConvertTo-Json -Depth 5
