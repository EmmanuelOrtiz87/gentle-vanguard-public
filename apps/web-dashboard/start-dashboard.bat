@echo off
REM start-dashboard.bat — Inicia el dashboard Gentle-Vanguard (modo oculto)
REM Delega en el launcher TS (src/dashboard-start.ts): el watchdog WS y Vite
REM corren como procesos ocultos, sin ventanas cmd /k persistentes.

echo ==========================================
echo  DASHBOARD GENTLE-VANGUARD - STARTER
echo ==========================================
echo.

REM Volver a la raiz del repo (apps/web-dashboard -> raiz)
cd /d "%~dp0..\.."

if not exist "package.json" (
  echo ERROR: No se encontro la raiz del repo.
  pause
  exit /b 1
)

echo Iniciando dashboard oculto (WS watchdog + Vite)...
node --import tsx src\dashboard-start.ts

echo.
echo ==========================================
echo  DASHBOARD INICIADO (procesos ocultos)
echo ==========================================
echo.
echo Cierra esta ventana; el dashboard sigue corriendo.
echo Para detenerlo: npx tsx src/dashboard-stop.ts
