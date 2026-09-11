@echo off
title MANPOWER Attendance System
cd /d %~dp0
echo.
echo  ==========================================
echo   MANPOWER ATTENDANCE SYSTEM
echo  ==========================================
echo.
python app.py
if errorlevel 1 (
    echo.
    echo  Failed to start. Is Python installed?
    pause
)