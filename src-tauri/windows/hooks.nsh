; PaperNest NSIS hooks — keep user library across upgrade / reinstall.
; Uninstaller only deletes known app files; PaperNestLibrary is not in that list.
; RMDir on $INSTDIR is non-recursive, so a non-empty PaperNestLibrary stays.

!macro NSIS_HOOK_PREINSTALL
  ; Overlay upgrade: leave existing $INSTDIR\PaperNestLibrary untouched.
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; App resolves library via library-location.json and existing library.db discovery.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Do not delete PaperNestLibrary — user papers / annotations live there.
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Intentional no-op: leave $INSTDIR\PaperNestLibrary for the next setup.
!macroend
