; Pulse — Windows installer (per-user, no admin rights needed)
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APP "Pulse"
!define EXE "Pulse.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Pulse"

Name "${APP}"
OutFile "..\desktop\dist\Pulse-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Pulse"
InstallDirRegKey HKCU "Software\Pulse" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Pulse ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Pulse"
VIAddVersionKey "FileDescription" "Pulse Setup"
VIAddVersionKey "CompanyName" "David LaBarre"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© David LaBarre"

!define MUI_ICON "..\tools\pulse.ico"
!define MUI_UNICON "..\tools\pulse.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Pulse ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Pulse is a lightweight music player for the songs on your PC.$\r$\n$\r$\nIf Pulse is already installed, this updates it. Your library, playlists and settings are kept."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Pulse"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Pulse (required)" SecMain
  SectionIn RO
  ; close a running copy so the file can be replaced
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 400
  SetOutPath "$INSTDIR"
  File "..\desktop\dist\Pulse.exe"
  WriteUninstaller "$INSTDIR\Uninstall Pulse.exe"
  CreateShortcut "$SMPROGRAMS\Pulse.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  WriteRegStr HKCU "Software\Pulse" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Pulse"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "David LaBarre"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall Pulse.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "https://github.com/Frenchbear1/Pulse"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Desktop shortcut" SecDesk
  CreateShortcut "$DESKTOP\Pulse.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The Pulse app and a Start Menu shortcut."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} "Put a Pulse shortcut on your desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Sleep 400
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\Uninstall Pulse.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Pulse.lnk"
  Delete "$DESKTOP\Pulse.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Pulse"
  ; your library, playlists and settings in %APPDATA% are left in place
SectionEnd
