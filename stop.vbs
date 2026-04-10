' Dashboard v1.0 — Stop Server
' Double-click this file to stop the running Dashboard server.
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "taskkill /F /IM node.exe", 0, True
MsgBox "Dashboard server stopped.", 64, "Dashboard v1.0"
