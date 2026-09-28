@echo off
cd /d "%~dp0"
echo [1/2] Cloudflare login may open a browser...
call npx wrangler login
if errorlevel 1 goto :fail
echo [2/2] Deploying to gemini-chat-no-wifi...
call npx wrangler pages deploy public --project-name gemini-chat-no-wifi
if errorlevel 1 goto :fail
echo.
echo Deployment finished.
pause
exit /b 0
:fail
echo.
echo Deployment failed. Check the error above.
pause
exit /b 1
