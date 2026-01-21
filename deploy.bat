@echo off
REM Demox MCP 一键部署脚本 (Windows)
REM 用于快速部署整个 MCP 服务

setlocal enabledelayedexpansion

REM 解析参数
set SKIP_DB_INIT=false
set SKIP_FUNCTIONS_DEPLOY=false
set SKIP_FRONTEND_BUILD=false
set SKIP_FRONTEND_DEPLOY=false

:parse_args
if "%~1"=="--skip-db" (
    set SKIP_DB_INIT=true
    shift
    goto parse_args
)
if "%~1"=="--skip-functions" (
    set SKIP_FUNCTIONS_DEPLOY=true
    shift
    goto parse_args
)
if "%~1"=="--skip-frontend-build" (
    set SKIP_FRONTEND_BUILD=true
    shift
    goto parse_args
)
if "%~1"=="--skip-frontend-deploy" (
    set SKIP_FRONTEND_DEPLOY=true
    shift
    goto parse_args
)
if "%~1"=="--help" (
    echo 用法: %0 [选项]
    echo.
    echo 选项:
    echo   --skip-db              跳过数据库初始化
    echo   --skip-functions       跳过云函数部署
    echo   --skip-frontend-build  跳过前端构建
    echo   --skip-frontend-deploy 跳过前端部署
    echo   --help                 显示帮助信息
    exit /b 0
)

REM 主流程
echo =============================================
echo   Demox MCP 一键部署脚本
echo =============================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] Node.js 未安装，请先安装 Node.js ^>= 18.0.0
    exit /b 1
)

echo [√] 环境检查通过
echo.

REM 步骤 1: 安装 MCP Server 依赖
echo =============================================
echo   步骤 1: 安装 MCP Server 依赖
echo =============================================
echo.
cd mcp-server
call npm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    exit /b 1
)
echo [√] MCP Server 依赖安装完成
cd ..
echo.

REM 步骤 2: 构建 MCP Server
echo =============================================
echo   步骤 2: 构建 MCP Server
echo =============================================
echo.
cd mcp-server
call npm run build
if %errorlevel% neq 0 (
    echo [错误] 构建失败
    exit /b 1
)
echo [√] MCP Server 构建完成
cd ..
echo.

REM 步骤 3: 初始化数据库
if "%SKIP_DB_INIT%"=="false" (
    echo =============================================
    echo   步骤 3: 初始化数据库
    echo =============================================
    echo.
    echo [i] 运行数据库初始化脚本...
    node scripts/init-oauth-db.js
    if %errorlevel% neq 0 (
        echo [错误] 数据库初始化失败
        exit /b 1
    )
    echo [√] 数据库初始化完成
    echo.
) else (
    echo [!] 跳过数据库初始化
    echo.
)

REM 步骤 4: 部署云函数
if "%SKIP_FUNCTIONS_DEPLOY%"=="false" (
    echo =============================================
    echo   步骤 4: 部署云函数
    echo =============================================
    echo.

    where cloudbase >nul 2>&1
    if %errorlevel% neq 0 (
        echo [!] CloudBase CLI 未安装，跳过云函数部署
        echo [i] 请手动安装: npm install -g @cloudbase/cli
    ) else (
        echo [i] 部署 oauth-token-manager 云函数...
        cloudbase functions:deploy oauth-token-manager
        echo [√] oauth-token-manager 部署完成

        echo [i] 更新 deploy-website 云函数...
        cloudbase functions:deploy deploy-website
        echo [√] deploy-website 更新完成
    )
    echo.
) else (
    echo [!] 跳过云函数部署
    echo.
)

REM 步骤 5: 构建前端
if "%SKIP_FRONTEND_BUILD%"=="false" (
    echo =============================================
    echo   步骤 5: 构建前端
    echo =============================================
    echo.
    call npm run build
    if %errorlevel% neq 0 (
        echo [错误] 前端构建失败
        exit /b 1
    )
    echo [√] 前端构建完成
    echo.
) else (
    echo [!] 跳过前端构建
    echo.
)

REM 步骤 6: 部署前端
if "%SKIP_FRONTEND_DEPLOY%"=="false" (
    echo =============================================
    echo   步骤 6: 部署前端
    echo =============================================
    echo.

    where cloudbase >nul 2>&1
    if %errorlevel% neq 0 (
        echo [!] CloudBase CLI 未安装，跳过前端部署
    ) else (
        echo [i] 部署到静态托管...
        cloudbase hosting deploy dist
        echo [√] 前端部署完成
    )
    echo.
) else (
    echo [!] 跳过前端部署
    echo.
)

REM 完成总结
echo =============================================
echo   部署完成！
echo =============================================
echo.
echo [i] 下一步操作：
echo.
echo 1. 访问 MCP 配置页面：
echo    https://demox.aigc.sx.cn/#/mcp-setup
echo.
echo 2. 下载配置文件并导入到 AI 工具
echo.
echo 3. 测试 MCP Server：
echo    cd mcp-server ^&^& npm run cli -- test
echo.

if "%SKIP_FUNCTIONS_DEPLOY%"=="true" (
    echo [!] 注意：云函数未部署，请手动部署：
    echo    cloudbase functions:deploy oauth-token-manager
    echo    cloudbase functions:deploy deploy-website
    echo.
)

echo [√] 所有步骤完成！

endlocal
