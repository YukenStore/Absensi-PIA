@echo off
echo ======================================================
echo   Membangun Shared Library C++ Core (pia_core.dll)
echo ======================================================

where g++ >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Menggunakan compiler MinGW g++...
    g++ -std=c++17 -O2 -shared -DPIA_CORE_EXPORTS -Iinclude src/pia_core.cpp -o pia_core.dll
    if %ERRORLEVEL% EQU 0 (
        echo [SUKSES] pia_core.dll berhasil dibuat!
        exit /b 0
    )
)

where clang++ >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Menggunakan compiler clang++...
    clang++ -std=c++17 -O2 -shared -DPIA_CORE_EXPORTS -Iinclude src/pia_core.cpp -o pia_core.dll
    if %ERRORLEVEL% EQU 0 (
        echo [SUKSES] pia_core.dll berhasil dibuat!
        exit /b 0
    )
)

where cl >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [INFO] Menggunakan compiler MSVC cl...
    cl /std:c++17 /O2 /LD /DPIA_CORE_EXPORTS /Iinclude src\pia_core.cpp /Fe:pia_core.dll
    if %ERRORLEVEL% EQU 0 (
        echo [SUKSES] pia_core.dll berhasil dibuat!
        exit /b 0
    )
)

echo [PERINGATAN] Compiler C++ (g++ / clang++ / MSVC) belum ditemukan di PATH.
echo Backend Python akan otomatis menggunakan fallback algoritma identik sampai pia_core.dll dikompilasi.
exit /b 1

