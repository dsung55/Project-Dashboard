' Dashboard v1.0 — Launcher
' Double-click this file to start the server and open the app in your browser.
Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Start Node server silently (window style 0 = hidden, no terminal window)
WshShell.Run "cmd /c node """ & scriptDir & "\server.js""", 0, False

' Wait 1.5 seconds for the server to be ready
WScript.Sleep 1500

' Open the app in the default browser
WshShell.Run "http://localhost:3000"
