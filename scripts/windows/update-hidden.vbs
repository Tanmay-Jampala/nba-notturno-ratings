' Runs update.cmd with no console window (window style 0) so the scheduled task doesn't flash a terminal.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & here & "\update.cmd""", 0, True
