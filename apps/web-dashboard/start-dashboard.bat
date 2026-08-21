@echo off
REM start-dashboard.bat — Script simple para iniciar el dashboard Gentle-Vanguard

echo ==========================================
echo  DASHBOARD GENTLE-VANGUARD - STARTER
echo ==========================================
echo.

REM Verificar que estamos en el directorio correcto
if not exist "package.json" (
  echo ERROR: Ejecutar desde C:\Workspace_local\gentle-vanguard\apps\web-dashboard
  exit /b 1
)

REM Configurar puerto WebSocket
set WS_PORT=8080

echo [1/2] Iniciando WebSocket Server en puerto %WS_PORT%...
echo.
start "WebSocket Server" cmd /k "cd /d %CD% && npx tsx server/websocket-server.ts"

echo [2/2] Iniciando Vite Frontend...
echo.
timeout /t 3 /nobreak >nul
start "Vite Frontend" cmd /k "cd /d %CD% && npx vite"

echo.
echo ==========================================
echo  DASHBOARD INICIADO
echo ==========================================
echo.
echo WebSocket:  http://localhost:%WS_PORT%
echo Dashboard:  http://localhost:5173
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
pause >nul
