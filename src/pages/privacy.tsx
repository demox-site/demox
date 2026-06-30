import React from "react";
import { useNavigate } from "react-router-dom";

const PrivacyPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <nav className="border-b border-[var(--stitch-line)] bg-[var(--stitch-surface)]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => navigate("/index")}
              className="flex items-center gap-2 focus:outline-none"
            >
              <div className="w-5 h-5 bg-[var(--stitch-ink)] rounded-lg flex items-center justify-center">
                <span className="text-primary-foreground text-xs font-bold">D</span>
              </div>
              <span className="text-lg font-bold tracking-tight">
                Demox<span className="animate-pulse">_</span>
              </span>
            </button>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-[var(--stitch-muted)] hover:text-[var(--stitch-ink)] transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Privacy Policy
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Demox 隐私政策
          </h1>
          <p className="text-sm text-[var(--stitch-muted)]">最近更新：2025-12-25</p>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            我们非常重视您的隐私与数据安全。本隐私政策旨在说明 Demox
            如何收集、使用、
            存储和保护您的个人信息，以及与内容审核相关的数据处理方式。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">一、我们收集的信息</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            根据合法、正当、必要的原则，我们可能会收集以下类别的信息：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>
              账号信息：用于注册和登录的邮箱地址、密码（以不可逆形式存储）、验证码等。
            </li>
            <li>
              使用信息：包括登录时间、登录
              IP、基础设备信息、操作日志等，用于安全审计 与服务质量分析。
            </li>
            <li>
              部署信息：您上传的代码压缩包、静态资源文件名称（例如 zip
              文件名）、项目 元数据、部署时间、访问统计等。
            </li>
            <li>
              内容审核相关信息：为实现自动审核功能而提取的特征信息，如图像特征、OCR
              文 本、识别到的 LOGO 或二维码等。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">二、我们如何使用这些信息</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            我们将收集到的信息用于以下目的：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>为您提供账号注册、登录、身份认证和基础账户服务。</li>
            <li>为您提供网站部署、存储、访问加速和相关技术支持。</li>
            <li>
              保障服务安全与合规，包括检测和防范违法内容、垃圾信息、攻击行为等。
            </li>
            <li>
              通过聚合和匿名化统计数据，分析服务性能，优化产品体验，不会将单个用户行为
              直接用于对外画像或商业出售。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">三、内容自动审核与合规要求</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            为遵守法律法规和监管要求，我们会对您上传的代码与生成的站点内容进行自动审
            核，具体说明如下：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>
              审核对象包括：上传的代码包、静态资源文件以及对外提供访问的页面内容。
            </li>
            <li>
              审核技术包括但不限于：图像识别、OCR 文本识别、LOGO
              检测、二维码/条形码 识别、敏感关键词识别等。
            </li>
            <li>
              重点审核类别包括：色情内容、政治敏感内容、暴力恐怖内容、违法广告营销、
              低质和不当内容等，具体范围以《使用协议与服务条款》中"禁止及重点审核内容"
              一章为准。
            </li>
            <li>
              审核结果可能导致您的内容被下线、访问受限、项目封禁或账号限制，以保障
              平台整体安全与合规。
            </li>
          </ul>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            使用 Demox
            即表示您理解并同意：内容会被自动审核，审核结果可能影响内容是否
            可继续对外访问。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">四、我们如何存储和保护信息</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            我们会采取合理且必要的安全措施保护您的信息，防止数据被未经授权地访问、使
            用、泄露、篡改或毁损，包括但不限于：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>使用符合行业标准的安全技术手段和访问控制策略。</li>
            <li>对核心系统和数据访问进行权限管理与操作审计。</li>
            <li>
              在符合法律法规和业务需要的前提下，设置合理的数据保存期限，超期的数据将被
              删除或匿名化处理。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            五、信息共享、转让与公开披露
          </h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            我们不会向任何无关第三方出售您的个人信息。仅在以下情形下，我们可能会共享、
            转让或公开披露相关信息：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>
              根据法律法规的规定、行政或司法机关的要求，必须对外提供的情况。
            </li>
            <li>
              为实现内容审核、存储与加速等必要功能，向受信任的云服务提供商或安全服务
              提供方共享必要的数据，这些第三方仅在约定目的范围内使用信息。
            </li>
            <li>
              依法进行的合并、分立、收购或资产转让等情形中，如涉及个人信息转让，我们会
              要求新的持有方继续受本政策约束，否则将重新征得您的授权同意。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">六、您的权利</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            在法律法规允许的范围内，您对自己的个人信息享有以下权利：
          </p>
          <ul className="text-sm text-[var(--stitch-muted)] space-y-1 list-disc pl-5">
            <li>访问与更正：您可以在账户设置中查看或更新部分注册信息。</li>
            <li>删除：在符合条件时，您可以请求删除部分个人信息或关闭账户。</li>
            <li>
              撤回同意：对于依赖您授权才进行的处理活动，您可以随时撤回授权，但这可能导
              致部分功能无法继续提供。
            </li>
          </ul>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            当您删除数据、关闭账号或撤回同意后，我们可能仍需在法律要求的保存期限内保留
            部分信息。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">七、与第三方服务的关系</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            您在 Demox
            上部署的站点可能会嵌入第三方服务（如统计工具、第三方脚本、外链
            资源等）。这些第三方可能会依据其自身的隐私政策收集和处理您的访问者数据，该
            等行为不由 Demox 控制或负责。
          </p>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            我们建议您在部署前仔细阅读相关第三方服务的隐私政策，并在您自建的站点中向您
            的最终用户做出必要的隐私说明。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">八、未成年人保护</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            若您为未成年人，请在监护人同意与指导下使用 Demox
            服务。我们不会在明知为未 成年人情况下收集其不必要的个人信息。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">九、本政策的更新</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            随着业务发展或法律法规的变更，我们可能会适时更新本隐私政策。重大变更时，我
            们会在显著位置提示或通过其他合理方式告知您。更新后的政策一经公布，即适用于
            所有新的使用行为。
          </p>
        </section>

        <section className="space-y-3 pb-10">
          <h2 className="text-xl font-semibold">十、联系我们</h2>
          <p className="text-sm text-[var(--stitch-muted)] leading-relaxed">
            如您对本隐私政策或个人信息保护事宜有任何问题、建议或投诉，可通过站内反馈渠
            道或官方联系方式与我们取得联系，我们会尽快予以回复和处理。
          </p>
        </section>
      </main>
    </div>
  );
};

export default PrivacyPage;
