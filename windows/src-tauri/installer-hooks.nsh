; Konscious was called Kova before it was renamed. Installing Konscious
; replaces an existing Kova install (our earlier per-user installer): Kova is
; closed and uninstalled silently first, the same way Tauri's installer
; replaces an older Konscious. Kova's data (%USERPROFILE%\.kova) is left
; alone; Konscious moves it to .konscious on first start.
!macro NSIS_HOOK_PREINSTALL
  Push $0
  Push $R8
  Push $R9
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kova" "UninstallString"
  ReadRegStr $R9 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kova" "InstallLocation"
  ${If} $R8 != ""
  ${AndIf} $R9 != ""
    ; InstallLocation is stored quoted; `_?=` needs the bare folder.
    StrCpy $0 $R9 1
    ${If} $0 == '"'
      StrCpy $R9 $R9 "" 1
      StrCpy $R9 $R9 -1
    ${EndIf}
    DetailPrint "Replacing Kova (previous version) in $R9"
    ; /S: silent (also closes a running Kova). `_?=` makes ExecWait wait for
    ; the uninstaller itself instead of a temp copy, which then can't remove
    ; its own file and folder — so tidy those up after.
    ExecWait '$R8 /S _?=$R9' $0
    Delete "$R9\uninstall.exe"
    RMDir "$R9"
  ${EndIf}
  Pop $R9
  Pop $R8
  Pop $0
!macroend
