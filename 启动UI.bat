@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   阴阳师对弈模拟器 - 本地启动器
echo ============================================
if not exist "apps\web\dist\index.html" (
  echo [1/2] 还没构建过产物，正在构建...
  pushd apps\web
  node node_modules\vite\bin\vite.js build
  popd
) else (
  echo [1/2] 已有产物 apps\web\dist
)
echo [2/2] 启动本地服务并打开浏览器...
node tools\serve-ui.mjs
pause
