@echo off
REM ===========================================================================
REM  PSS06 - PRGI Title Verification System
REM  Starts all three services in separate windows.
REM
REM  Prerequisites (one time):
REM     pip install -r ai-service\requirements.txt
REM     cd backend  && npm install && cd ..
REM     cd frontend && npm install && cd ..
REM     python scripts\init_db.py
REM     python scripts\build_faiss_index.py
REM ===========================================================================

echo.
echo  Starting PSS06 - PRGI Title Verification System
echo  ----------------------------------------------
echo   1. Python AI service   http://127.0.0.1:8000
echo   2. Node.js backend     http://localhost:5000
echo   3. React frontend      http://localhost:3000
echo.

start "PSS06 AI Service" cmd /k "cd /d %~dp0ai-service && python -m uvicorn main:app --host 127.0.0.1 --port 8000"

REM Give the AI service a head start - it loads the corpus and the index.
timeout /t 12 /nobreak >nul

start "PSS06 Backend" cmd /k "cd /d %~dp0backend && npm start"

timeout /t 4 /nobreak >nul

start "PSS06 Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo  All three services are starting in separate windows.
echo  Open http://localhost:3000 once the frontend window says "ready".
echo.
echo  Demo login:  admin@prgi.gov  /  admin123
echo.
pause
