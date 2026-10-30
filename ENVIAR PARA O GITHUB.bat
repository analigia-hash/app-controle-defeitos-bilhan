@echo off
title Enviar para o GitHub
cd /d "%~dp0"

echo.
echo  ===============================================
echo    ENVIANDO O CODIGO PARA O GITHUB
echo  ===============================================
echo.
echo  Se for a primeira vez, vai abrir uma janela do
echo  navegador pedindo para voce entrar no GitHub e
echo  autorizar o acesso. Pode autorizar.
echo.
echo  Aguarde...
echo.

git push -u origin main

echo.
if errorlevel 1 (
  echo  ===============================================
  echo    ALGO DEU ERRADO
  echo  ===============================================
  echo  Tire um print desta janela e mostre ao Claude.
) else (
  echo  ===============================================
  echo    PRONTO - CODIGO ENVIADO COM SUCESSO
  echo  ===============================================
  echo  A Netlify publica sozinha em 1 ou 2 minutos.
)
echo.
pause
