Dim shell, scriptDir, runnerPath, cmd
Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
runnerPath = scriptDir & "\run-monitor.ps1"
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & runnerPath & """"
shell.Run cmd, 0, True
