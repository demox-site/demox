#!/bin/bash

# Demox MCP 一键部署脚本
# 用于快速部署整个 MCP 服务

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 打印标题
print_title() {
    echo ""
    echo -e "${BLUE}=============================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}=============================================${NC}"
    echo ""
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 主函数
main() {
    print_title "Demox MCP 一键部署脚本"

    # 检查必要的命令
    print_info "检查环境..."
    if ! command_exists node; then
        print_error "Node.js 未安装，请先安装 Node.js >= 18.0.0"
        exit 1
    fi

    if ! command_exists npm; then
        print_error "npm 未安装"
        exit 1
    fi

    print_success "环境检查通过"

    # 解析参数
    SKIP_DB_INIT=${SKIP_DB_INIT:-false}
    SKIP_FUNCTIONS_DEPLOY=${SKIP_FUNCTIONS_DEPLOY:-false}
    SKIP_FRONTEND_BUILD=${SKIP_FRONTEND_BUILD:-false}
    SKIP_FRONTEND_DEPLOY=${SKIP_FRONTEND_DEPLOY:-false}

    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-db)
                SKIP_DB_INIT=true
                shift
                ;;
            --skip-functions)
                SKIP_FUNCTIONS_DEPLOY=true
                shift
                ;;
            --skip-frontend-build)
                SKIP_FRONTEND_BUILD=true
                shift
                ;;
            --skip-frontend-deploy)
                SKIP_FRONTEND_DEPLOY=true
                shift
                ;;
            --help)
                echo "用法: $0 [选项]"
                echo ""
                echo "选项:"
                echo "  --skip-db              跳过数据库初始化"
                echo "  --skip-functions       跳过云函数部署"
                echo "  --skip-frontend-build  跳过前端构建"
                echo "  --skip-frontend-deploy 跳过前端部署"
                echo "  --help                 显示帮助信息"
                exit 0
                ;;
            *)
                print_error "未知选项: $1"
                echo "使用 --help 查看帮助"
                exit 1
                ;;
        esac
    done

    # 步骤 1: 安装 MCP Server 依赖
    print_title "步骤 1: 安装 MCP Server 依赖"
    cd mcp-server
    npm install
    print_success "MCP Server 依赖安装完成"
    cd ..

    # 步骤 2: 构建 MCP Server
    print_title "步骤 2: 构建 MCP Server"
    cd mcp-server
    npm run build
    print_success "MCP Server 构建完成"
    cd ..

    # 步骤 3: 初始化数据库
    if [ "$SKIP_DB_INIT" = false ]; then
        print_title "步骤 3: 初始化数据库"
        print_info "运行数据库初始化脚本..."
        node scripts/init-oauth-db.js
        print_success "数据库初始化完成"
    else
        print_warning "跳过数据库初始化"
    fi

    # 步骤 4: 部署云函数
    if [ "$SKIP_FUNCTIONS_DEPLOY" = false ]; then
        print_title "步骤 4: 部署云函数"

        if command_exists cloudbase; then
            print_info "部署 oauth-token-manager 云函数..."
            cloudbase functions:deploy oauth-token-manager
            print_success "oauth-token-manager 部署完成"

            print_info "更新 deploy-website 云函数..."
            cloudbase functions:deploy deploy-website
            print_success "deploy-website 更新完成"
        else
            print_warning "CloudBase CLI 未安装，跳过云函数部署"
            print_info "请手动安装: npm install -g @cloudbase/cli"
        fi
    else
        print_warning "跳过云函数部署"
    fi

    # 步骤 5: 构建前端
    if [ "$SKIP_FRONTEND_BUILD" = false ]; then
        print_title "步骤 5: 构建前端"
        npm run build
        print_success "前端构建完成"
    else
        print_warning "跳过前端构建"
    fi

    # 步骤 6: 部署前端
    if [ "$SKIP_FRONTEND_DEPLOY" = false ]; then
        print_title "步骤 6: 部署前端"

        if command_exists cloudbase; then
            print_info "部署到静态托管..."
            cloudbase hosting deploy dist
            print_success "前端部署完成"
        else
            print_warning "CloudBase CLI 未安装，跳过前端部署"
        fi
    else
        print_warning "跳过前端部署"
    fi

    # 完成总结
    print_title "部署完成！"

    echo ""
    print_info "下一步操作："
    echo ""
    echo "1. 访问 MCP 配置页面："
    echo "   https://demox.aigc.sx.cn/#/mcp-setup"
    echo ""
    echo "2. 下载配置文件并导入到 AI 工具"
    echo ""
    echo "3. 测试 MCP Server："
    echo "   cd mcp-server && npm run cli -- test"
    echo ""

    if [ "$SKIP_FUNCTIONS_DEPLOY" = true ]; then
        print_warning "注意：云函数未部署，请手动部署："
        echo "   cloudbase functions:deploy oauth-token-manager"
        echo "   cloudbase functions:deploy deploy-website"
        echo ""
    fi

    print_success "所有步骤完成！"
}

# 运行主函数
main "$@"
