'use strict';

/**
 * 平台运行时池的期望配置。只给基础设施负责人阅读。
 * 本模块不创建云资源，不读取密钥，也不拨任何数据库地址。
 * MYSQL 主机只来自该账号网关上的 MYSQL_HOST。
 */
const PLATFORM_POOL_SPEC = Object.freeze({
  functionName: 'demox-platform-nodejs',
  cloud: 'tencent-scf',
  namespace: 'demox',
  region: 'ap-guangzhou',
  runtime: 'Nodejs18.15',
  handler: 'runtime-nodejs.main',
  memoryMB: 512,
  timeoutSec: 300,
  releaseVia: 'none',
  triggers: ['http:internal'],
  environmentNames: ['FUNCTION_RUNTIME', 'RUNTIME_INVOKE_SECRET'],
  capacity: Object.freeze({
    reservedConcurrency: null,
    authProvisionedConcurrency: 0,
    authProvisionedConcurrencyReason: '本 PR 不预置并发，也不调用预置并发接口。登录在用户关键路径上，平台池是独立 SCF，闲置后的冷启动会再加一跳 Invoke。以后要打开 /auth 前缀时，建议只给这个池预置 1 个实例。website、mcp、cert-renew 不预置：发布和定时器可以接受冷启动。开关关闭期间预置没有流量，只会空转。'
  }),
  network: Object.freeze({
    vpcId: 'REPLACE_ME_VPC_ID',
    subnetId: 'REPLACE_ME_SUBNET_ID',
    mysqlHostEnv: 'MYSQL_HOST',
    mysqlPortEnv: 'MYSQL_PORT',
    mysqlUserEnv: 'MYSQL_USER',
    mysqlDatabaseEnv: 'MYSQL_DATABASE',
    yidianP1: 'public-ip-allowlist',
    plannedPeeringCidr: '10.1.0.0/16',
    note: '易点 P1 经公网 IP 白名单访问 MySQL，主机只读 MYSQL_HOST。plannedPeeringCidr 不是拨号地址，代码不会连接它。对等建立之后由基础设施负责人填写 vpcId 和 subnetId。用户池的网络配置不动。'
  }),
  camRole: Object.freeze({
    name: 'demox-platform-runtime-role',
    policyName: 'demox-platform-runtime-policy',
    note: '只绑定到 demox-platform-nodejs，策略保持空。不要绑到 demox-user-nodejs。前缀打开后，auth / website / mcp 由网关 AssumeRole 到 demox-runtime-role，会话策略只含 COS、EO、DNS、IMS，不含 ses，不含 cls，临时密钥只放进当次调用的环境变量。发信走 demox-platform-ses，不走这份会话。证书 SSL 继续用网关或 cert-renew 的角色凭证，不带会话策略，不交给业务函数。不建长期子用户，不写 DEMOX_BIZ_*。用户池 worker 不改。前缀开关默认空。BUSINESS_ROLE_ARN 正好是磷 demox-runtime-role 时，进程内 auth / website / mcp（含 analytics-rollup 定时器）的 COS、EO、IMS 也用这份会话凭证，没有会话就抛错。ARN 已设置但不在白名单，或显式 session 却没配 ARN，也抛错，不读 TENCENTCLOUD_*。只有没配 ARN，或 BUSINESS_CREDENTIALS_MODE=execution-role，才读执行角色。平台 SES 与 cert-renew 不走这条。'
  }),
  gateway: Object.freeze({
    secretKeyEnv: 'PLATFORM_SECRETS_KEY',
    secretKeyIdEnv: 'PLATFORM_SECRETS_KEY_ID',
    secretKeyringEnv: 'PLATFORM_SECRETS_KEYRING',
    prefixSwitchEnv: 'FUNCTIONS_PLATFORM_RUNTIME_PREFIXES',
    poolFunctionEnv: 'FUNCTIONS_PLATFORM_NODE_RUNTIME',
    poolUrlEnv: 'FUNCTIONS_PLATFORM_NODE_RUNTIME_URL',
    poolModeEnv: 'FUNCTIONS_PLATFORM_NODE_RUNTIME_MODE',
    cipher: 'AES-256-GCM',
    kms: false,
    reuseEncryptionKey: false,
    prefixSwitchDefault: ''
  }),
  accounts: Object.freeze({
    functionMetadataDb: 'per-gateway-env',
    cosCodePackages: 'per-account-bucket',
    detail: '仓库没有把磷和易点指到同一个函数元数据库。demox-function-api 各自读自己的 MYSQL_HOST / MYSQL_DATABASE，CI 发布只换代码，不复制环境变量。已登记的 MySQL 只有磷侧共享实例 cdb-fg5tqemn，没有第二套库的名字。统一包各传各的桶：磷 APPID 1307257815，易点 APPID 1490780430（DEMOX_EK_COS_BUCKET，桶名不在仓库里），版本号独立（version 与 version_ek）。函数代码包桶是各网关的 FUNCTIONS_COS_BUCKET，同样不共享。'
  }),
  resources: Object.freeze({
    cos: Object.freeze([
      Object.freeze({
        bucket: 'resource-game-1307257815',
        region: 'ap-chengdu',
        usedBy: 'website',
        why: '站点文件默认桶（LEGACY_BUCKET），回源主机 sites.demox.site。上传、读取、删除、列举对象。'
      }),
      Object.freeze({
        bucket: 'demox-analytics-raw-1307257815',
        region: 'ap-chengdu',
        usedBy: 'website',
        why: '原始统计对象。代码读的是 ANALYTICS_RAW_BUCKET_ID（storage_buckets 的 id），文档和 CI 里这个桶名对应那份原始日志。平台函数只需要读对象和列举，不上传统一包。'
      }),
      Object.freeze({
        bucket: 'FUNCTIONS_COS_BUCKET on demox-function-api',
        region: 'FUNCTIONS_COS_REGION',
        usedBy: 'gateway',
        why: '函数代码包由网关读取后把源码放进 Invoke。平台池角色不需要这个桶。磷 CI 默认桶是 demox-analytics-raw-1307257815；易点桶名来自仓库变量 DEMOX_EK_COS_BUCKET，仓库里没有具体名字。'
      })
    ]),
    edgeone: Object.freeze({
      zoneId: 'zone-3kplfkbflnd6',
      zoneEnv: 'EDGEONE_ZONE_ID',
      hosts: ['demox.site', '*.demox.site'],
      actions: ['teo:CreatePurgeTask', 'teo:DescribeAccelerationDomains', 'teo:ModifyHostsCertificate'],
      why: 'website 清缓存；cert-renew 读加速域名并绑定上传证书。代码默认这个 zone id，可用环境变量覆盖。'
    }),
    certificates: Object.freeze([
      Object.freeze({
        name: '*.demox.site',
        env: 'CERT_DOMAIN',
        where: 'EdgeOne 上传证书 + 腾讯云 SSL'
      }),
      Object.freeze({
        name: 'demox.site',
        env: 'CERT_SAN',
        where: 'EdgeOne 上传证书 + 腾讯云 SSL'
      }),
      Object.freeze({
        name: 'api.demox.site',
        env: 'SCF_CUSTOM_DOMAIN',
        where: 'SCF 自定义域名上的证书。cert-renew 读取并只改写上传证书。'
      }),
      Object.freeze({
        name: 'www.demox.site',
        where: 'cert-renew 只记录到期，不改写。'
      })
    ]),
    cls: Object.freeze({
      topic: 'SCF_logtopic_yorder',
      retentionDays: 7,
      apiPermission: false,
      why: '平台代码不调用 CLS API。SCF 把函数返回值写进这个主题。website 的部署次数回填按主题里的 uploadedCount 去重。新池要投递到同一个主题，否则回填看不到平台池的日志。'
    }),
    mail: Object.freeze({
      service: 'ses',
      host: 'ses.tencentcloudapi.com',
      region: 'ap-hongkong',
      domain: 'mail.demox.site',
      from: 'noreply@mail.demox.site',
      fallbackFrom: 'noreply@mail.aigc.sx.cn',
      templates: Object.freeze([
        Object.freeze({ id: 137482, usedBy: 'auth', purpose: '登录验证码。代码默认发件人 noreply@mail.demox.site。' }),
        Object.freeze({ id: 226012, usedBy: 'website', purpose: '站点停用通知。自定义正文发送目前没有权限，必须走模板。' })
      ]),
      action: 'ses:SendEmail'
    })
  }),
  minimalPolicy: Object.freeze([
    'cos:GetObject、cos:PutObject、cos:DeleteObject、cos:GetBucket，资源限于 resource-game-1307257815',
    'cos:GetObject、cos:GetBucket，资源限于 demox-analytics-raw-1307257815 中统计原始日志所在前缀',
    'teo:CreatePurgeTask、teo:DescribeAccelerationDomains、teo:ModifyHostsCertificate，资源限于 zone-3kplfkbflnd6',
    'ssl:UploadCertificate、ssl:DescribeCertificate、ssl:DescribeCertificates',
    'scf:GetCustomDomain、scf:UpdateCustomDomain，资源限于自定义域名 api.demox.site',
    'dnspod:CreateRecord、dnspod:DeleteRecord，资源限于域名 demox.site（证书 DNS-01）',
    'ims:ImageModeration 可选。website 内容审核调用它，无权限时回退本地规则，不阻断发布'
  ]),
  switches: Object.freeze({
    defaultMode: 'in-process',
    prefixSwitchDefault: 'off',
    userPoolReceivesPlatformSecrets: false,
    deploy: false,
    businessSessionPolicy: 'cos-eo-dns-ims',
    certificateCredentials: 'role-without-session-policy',
    longLivedBizKeys: false
  })
});

module.exports = { PLATFORM_POOL_SPEC };
