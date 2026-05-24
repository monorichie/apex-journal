@echo off
echo.
echo  ══════════════════════════════════════════════
echo   APEX JOURNAL — MT5 SYNC SETUP
echo  ══════════════════════════════════════════════
echo.
echo  Installing required packages...
pip install MetaTrader5 pandas requests
echo.
echo  Starting setup wizard...
python mt5_sync.py --setup
echo.
pause
