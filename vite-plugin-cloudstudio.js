import path from "path";
/**
 * Vite Plugin for CloudStudio
 * 自动检测并配置 CloudStudio 开发环境
 */
export function cloudStudio() {
    // 环境检测函数
    const isCloudStudio = () => {
        return !!path.basename(process.cwd()).includes('ai-builder-code-editor')
    }

    return {
        name: 'vite-plugin-cloudstudio',

        // 修改 Vite 配置
        config: (config, { command }) => {
            if (!isCloudStudio() || command !== 'serve') {
                return
            }

            console.log('🚀 CloudStudio 环境已检测到，自动启动配置...')

            return {
                server: {
                    allowedHosts: [
                        '.cloudstudio.work',
                        'localhost',
                        '127.0.0.1'
                    ],
                    port: config.server?.port || 8080,
                    strictPort: false,
                }
            }
        },

        // 配置服务器启动后的提示
        configureServer(server) {
            if (!isCloudStudio()) return

            const protocol = server.config.server.https ? 'https' : 'http'
            const port = server.config.server.port

            server.httpServer?.once('listening', () => {
                setTimeout(() => {
                    console.log('\n  🌟 CloudStudio 访问地址:')
                    console.log(`     请在弹窗中选择内置预览或在端口中复制域名`)
                    console.log('\n')
                }, 100)
            })
        }
    }
}

// 支持默认导出
export default cloudStudio