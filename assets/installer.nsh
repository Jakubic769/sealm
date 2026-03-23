; assets/installer.nsh
; Customowy skrypt NSIS dla SEALM Launcher
; Dodaje własną stronę powitalną i logo do instalatora

!macro customHeader
  !system "echo '' > /dev/null"
!macroend

!macro customInit
  ; Sprawdź czy poprzednia wersja jest zainstalowana
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{com.sealm.launcher}" "UninstallString"
  StrCmp $R0 "" done
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
    "SEALM jest już zainstalowany. $\n$\nKliknij OK aby odinstalować poprzednią wersję lub Anuluj aby przerwać instalację." \
    IDOK uninst
  Abort
  uninst:
    ClearErrors
    ExecWait '$R0 _?=$INSTDIR'
  done:
!macroend

!macro customInstall
  ; Utwórz skrót na pulpicie z ikoną
  CreateShortcut "$DESKTOP\SEALM.lnk" "$INSTDIR\SEALM.exe" "" "$INSTDIR\SEALM.exe" 0

  ; Zarejestruj protokół magnet: (opcjonalnie — użytkownik może woleć własny klient)
  ; WriteRegStr HKCR "magnet" "" "URL:Magnet Protocol"
  ; WriteRegStr HKCR "magnet" "URL Protocol" ""
  ; WriteRegStr HKCR "magnet\shell\open\command" "" '"$INSTDIR\SEALM.exe" "--magnet=%1"'

  ; Dodaj do rejestru Windows — "Otwórz z SEALM"
  WriteRegStr HKLM "Software\SEALM" "InstallPath" "$INSTDIR"
  WriteRegStr HKLM "Software\SEALM" "Version"     "${VERSION}"
!macroend

!macro customUnInstall
  ; Usuń skrót z pulpitu
  Delete "$DESKTOP\SEALM.lnk"
  ; Usuń klucze rejestru
  DeleteRegKey HKLM "Software\SEALM"
  ; Pytanie o usunięcie danych użytkownika
  MessageBox MB_YESNO "Czy usunąć dane użytkownika SEALM (bibliotekę, ustawienia)?" IDNO skip_data
    RMDir /r "$APPDATA\sealm"
  skip_data:
!macroend
