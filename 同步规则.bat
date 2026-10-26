@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo [1/4] 同步规则到云函数...
node scripts/sync-rules.mjs
if errorlevel 1 goto fail

echo.
echo [2/4] 检查打卡规则和当前配置...
node scripts/smoke-test.mjs
if errorlevel 1 goto fail

echo.
echo [3/4] 用假数据库测试云函数逻辑...
node scripts/cloud-test.mjs
if errorlevel 1 goto fail

echo.
echo [4/4] 全部通过。还差一步必须手动做：
echo.
echo    微信开发者工具 -^> 右键 cloudfunctions/api
echo    -^> 上传并部署：云端安装依赖
echo.
echo    不重新部署，云端还是旧代码（旧规则），打卡会被拒绝。
echo.
pause
exit /b 0

:fail
echo.
echo 出错了：看上面标 ❌ 的那一行。
echo 如果提示 "node 不是内部或外部命令"，说明电脑没装 Node.js。
echo 如果是规则相关的红字，说明 rules.js 里的时间写错格式了（要像 21:30 这样）。
echo.
pause
exit /b 1
