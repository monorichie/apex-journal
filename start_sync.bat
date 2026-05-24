@echo off
echo.
echo  APEX JOURNAL — MT5 SYNC RUNNING
echo  Make sure MetaTrader 5 is open and logged in
echo  Press Ctrl+C to stop
echo.
python mt5_sync.py --watch
pause
