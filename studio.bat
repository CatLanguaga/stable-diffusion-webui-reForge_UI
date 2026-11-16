@echo off
REM Lanza reForge con la API (necesaria para Studio) y abre http://127.0.0.1:7860/studio cuando el server responde.
REM Cerrar esta ventana (o Ctrl+C) apaga el server.
cd /d "%~dp0"
set COMMANDLINE_ARGS=
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "while($true){try{$c=New-Object Net.Sockets.TcpClient('127.0.0.1',7860);$c.Close();break}catch{Start-Sleep 2}}; Start-Sleep 3; Start-Process 'http://127.0.0.1:7860/studio/'"
venv\Scripts\python.exe launch.py --no-download-sd-model --api --skip-prepare-environment --medvram-sdxl
pause
