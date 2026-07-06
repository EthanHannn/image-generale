!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RMDir /r "$DOCUMENTS\ImageGenerator\history-data"
    RMDir "$DOCUMENTS\ImageGenerator"
  ${EndIf}
!macroend
