@echo off
cd /d "%~dp0"
echo 付箋TODO を組み立て中...
copy /b FusenTodo-win.zip.partaa + FusenTodo-win.zip.partab + FusenTodo-win.zip.partac FusenTodo-win.zip
echo.
echo 完成しました！FusenTodo-win.zip を解凍して FusenTodo.exe を起動してください。
pause
