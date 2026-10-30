@echo off
title Controle de Defeitos - servidor local (NAO FECHE esta janela)
cd /d "%~dp0"

echo.
echo  ===============================================
echo    APP CONTROLE DE DEFEITOS - BILHAN
echo  ===============================================
echo.
echo  Ligando o app no seu computador...
echo  O navegador abre sozinho em alguns segundos.
echo.
echo  NAO FECHE esta janela preta enquanto estiver
echo  usando o app. Para desligar, feche a janela.
echo.

if not exist node_modules (
  echo  Primeira vez: instalando dependencias...
  call npm install
)

start "" /min cmd /c "timeout /t 6 /nobreak >nul & start "" http://localhost:5174"

node "node_modules\vite\bin\vite.js" --port 5174

echo.
echo  O servidor parou. Pode fechar esta janela.
pause
