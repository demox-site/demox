const mysql = require('mysql2/promise');

// 凭据从环境变量读取（见 .env.example）；本地可临时 export 后运行
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'demox'
};

async function initDatabase() {
  console.log('🔌 正在连接MySQL...\n');

  const connection = await mysql.createConnection(dbConfig);
  console.log('✅ 连接成功！\n');

  try {
    // 1. 用户表
    console.log('📋 创建表: users...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY COMMENT '用户ID（对应_openid）',
        email VARCHAR(255) UNIQUE NOT NULL COMMENT '邮箱',
        password_hash VARCHAR(255) COMMENT '密码哈希',
        email_verified BOOLEAN DEFAULT FALSE COMMENT '邮箱是否验证',
        github_id VARCHAR(32) UNIQUE COMMENT 'GitHub 用户数字ID',
        github_login VARCHAR(255) COMMENT 'GitHub 用户名',
        feishu_open_id VARCHAR(128) COMMENT '飞书应用内用户唯一标识',
        feishu_union_id VARCHAR(128) COMMENT '飞书开发者维度用户唯一标识',
        feishu_name VARCHAR(255) COMMENT '飞书用户名称',
        avatar_url VARCHAR(500) COMMENT '头像URL',
        nickname VARCHAR(255) COMMENT '昵称',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_github_id (github_id),
        UNIQUE KEY uniq_feishu_open_id (feishu_open_id),
        UNIQUE KEY uniq_feishu_union_id (feishu_union_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ users 表创建成功\n');

    // 1b. 兼容已存在的 users 表：补充 GitHub 相关字段（幂等）
    console.log('📋 迁移 users 表：补充 GitHub 字段...');
    const userColumns = await connection.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const existingCols = new Set(userColumns[0].map((r) => r.COLUMN_NAME));
    const addColumn = async (name, ddl) => {
      if (!existingCols.has(name)) {
        await connection.execute(`ALTER TABLE users ADD COLUMN ${ddl}`);
        console.log(`  + 已添加列 ${name}`);
      }
    };
    await addColumn('github_id', `github_id VARCHAR(32) UNIQUE COMMENT 'GitHub 用户数字ID'`);
    await addColumn('github_login', `github_login VARCHAR(255) COMMENT 'GitHub 用户名'`);
    await addColumn('feishu_open_id', `feishu_open_id VARCHAR(128) COMMENT '飞书应用内用户唯一标识'`);
    await addColumn('feishu_union_id', `feishu_union_id VARCHAR(128) COMMENT '飞书开发者维度用户唯一标识'`);
    await addColumn('feishu_name', `feishu_name VARCHAR(255) COMMENT '飞书用户名称'`);
    await addColumn('avatar_url', `avatar_url VARCHAR(500) COMMENT '头像URL'`);
    await addColumn('nickname', `nickname VARCHAR(255) COMMENT '昵称'`);
    const [userIndexes] = await connection.execute(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    const existingIndexes = new Set(userIndexes.map((r) => r.INDEX_NAME));
    if (!existingIndexes.has('uniq_feishu_open_id')) {
      await connection.execute('ALTER TABLE users ADD UNIQUE KEY uniq_feishu_open_id (feishu_open_id)');
    }
    if (!existingIndexes.has('uniq_feishu_union_id')) {
      await connection.execute('ALTER TABLE users ADD UNIQUE KEY uniq_feishu_union_id (feishu_union_id)');
    }
    console.log('✅ users 表迁移完成\n');

    // 1c. 项目表
    console.log('📋 创建表: projects...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL COMMENT '项目归属用户ID',
        name VARCHAR(255) NOT NULL DEFAULT 'default' COMMENT '项目显示名称',
        slug VARCHAR(64) NOT NULL DEFAULT 'default' COMMENT '用户内唯一项目标识',
        description TEXT DEFAULT NULL,
        color VARCHAR(32) DEFAULT NULL,
        icon VARCHAR(64) DEFAULT NULL,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_project_slug (user_id, slug),
        INDEX idx_projects_user_id (user_id),
        INDEX idx_projects_archived (archived)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户项目表'
    `);
    console.log('✅ projects 表创建成功\n');

    // 2. 网站资源表
    console.log('📋 创建表: websites...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS websites (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL COMMENT '用户ID',
        website_id VARCHAR(8) NOT NULL COMMENT '网站ID（8位大写字母数字）',
        file_name VARCHAR(255) NOT NULL COMMENT '文件名',
        name VARCHAR(255) COMMENT '网站显示名称',
        path VARCHAR(500) NOT NULL COMMENT 'COS路径',
        url VARCHAR(500) COMMENT '访问URL',
        tags JSON COMMENT '标签数组',
        project_id BIGINT DEFAULT NULL COMMENT '所属项目(projects.id)',
        visibility VARCHAR(16) NOT NULL DEFAULT 'public' COMMENT '站点访问级别: public/private',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_website_id (website_id),
        INDEX idx_path (path(255)),
        INDEX idx_project_id (project_id),
        INDEX idx_visibility (visibility),
        INDEX idx_user_project_updated (user_id, project_id, updated_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ websites 表创建成功\n');

    // 3. OAuth客户端表
    console.log('📋 创建表: oauth_clients...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        id VARCHAR(64) PRIMARY KEY,
        client_secret VARCHAR(255) NOT NULL,
        redirect_uris JSON NOT NULL COMMENT '重定向URI数组',
        scopes JSON COMMENT '权限范围',
        client_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ oauth_clients 表创建成功\n');

    // 4. OAuth授权码表
    console.log('📋 创建表: oauth_auth_codes...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS oauth_auth_codes (
        code VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        client_id VARCHAR(64) NOT NULL,
        redirect_uri VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        scopes JSON,
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ oauth_auth_codes 表创建成功\n');

    // 5. OAuth刷新令牌表
    console.log('📋 创建表: oauth_refresh_tokens...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        token VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        client_id VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        scopes JSON,
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (client_id) REFERENCES oauth_clients(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ oauth_refresh_tokens 表创建成功\n');

    // 6. MCP会话表
    console.log('📋 创建表: mcp_sessions...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS mcp_sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        client_id VARCHAR(64),
        token VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_token (token),
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ mcp_sessions 表创建成功\n');

    // 7. 用户角色关联表
    console.log('📋 创建表: user_roles...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id VARCHAR(64) PRIMARY KEY,
        roles JSON NOT NULL COMMENT '角色数组，如["user", "admin"]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ user_roles 表创建成功\n');

    // 8. 角色配置表
    console.log('📋 创建表: roles...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS roles (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        priority INT DEFAULT 0,
        enabled BOOLEAN DEFAULT TRUE,
        max_file_count INT COMMENT '最大文件数量限制',
        allowed_extensions JSON COMMENT '允许的文件扩展名数组',
        description TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ roles 表创建成功\n');

    // 9. 任务进度表
    console.log('📋 创建表: task_progress...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS task_progress (
        task_id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        website_id VARCHAR(8),
        status VARCHAR(50) NOT NULL,
        progress_data JSON COMMENT '进度数据',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ task_progress 表创建成功\n');

    // 10. 审计日志表
    console.log('📋 创建表: oauth_audit_log...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS oauth_audit_log (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id VARCHAR(64),
        action VARCHAR(100) NOT NULL,
        details JSON COMMENT '详细信息',
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_action (action),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('✅ oauth_audit_log 表创建成功\n');

    // 11. 插入默认角色配置
    console.log('📋 插入默认角色配置...');
    await connection.execute(`
      INSERT IGNORE INTO roles (id, name, priority, enabled, max_file_count, allowed_extensions, description)
      VALUES
        ('admin', '管理员', 100, TRUE, NULL, NULL, '系统管理员，无限制'),
        ('pro', '专业用户', 50, TRUE, 1000, NULL, '专业用户，限制1000个文件'),
        ('user', '普通用户', 10, TRUE, 100, NULL, '普通用户，限制100个文件')
    `);
    console.log('✅ 默认角色配置插入成功\n');

    // 显示表列表
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('📊 当前数据库表列表：\n');
    tables.forEach((row, index) => {
      const tableName = Object.values(row)[0];
      console.log(`  ${index + 1}. ${tableName}`);
    });

    console.log('\n✨ 数据库初始化完成！\n');

  } catch (error) {
    console.error('❌ 错误:', error.message);
    throw error;
  } finally {
    await connection.end();
    console.log('🔌 连接已关闭\n');
  }
}

initDatabase().catch(console.error);
