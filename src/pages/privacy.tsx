import React from "react";
import { useLanguage } from "@/hooks/use-language";
import { LegalArticle, LegalList, LegalP, LegalSection } from "@/components/LegalArticle";

const copy = {
  zh: {
    eyebrow: "Privacy Policy",
    title: "Demox 隐私政策",
    updated: "最近更新：2026-07-21",
    intro:
      "我们非常重视您的隐私与数据安全。本隐私政策说明 Demox 如何收集、使用、存储和保护您的个人信息，以及与内容审核相关的数据处理方式。",
    collectTitle: "一、我们收集的信息",
    collectLead: "根据合法、正当、必要的原则，我们可能会收集以下类别的信息：",
    collectItems: [
      "账号信息：用于注册和登录的邮箱地址、密码（以不可逆形式存储）、验证码等。",
      "第三方登录信息：当您选择飞书登录时，我们会接收并保存飞书用户标识、姓名和头像，用于识别账号与展示资料；我们不会保存飞书访问令牌。",
      "使用信息：包括登录时间、登录 IP、基础设备信息、操作日志等，用于安全审计与服务质量分析。",
      "部署信息：您上传的代码压缩包、静态资源文件名称（例如 zip 文件名）、项目元数据、部署时间、访问统计等。",
      "内容审核相关信息：为实现自动审核功能而提取的特征信息，如图像特征、OCR 文本、识别到的 LOGO 或二维码等。",
    ],
    useTitle: "二、我们如何使用这些信息",
    useLead: "我们将收集到的信息用于以下目的：",
    useItems: [
      "为您提供账号注册、登录、身份认证和基础账户服务。",
      "为您提供网站部署、存储、访问加速和相关技术支持。",
      "保障服务安全与合规，包括检测和防范违法内容、垃圾信息、攻击行为等。",
      "通过聚合和匿名化统计数据，分析服务性能，优化产品体验，不会将单个用户行为直接用于对外画像或商业出售。",
    ],
    reviewTitle: "三、内容自动审核与合规要求",
    reviewLead:
      "为遵守法律法规和监管要求，我们会对您上传的代码与生成的站点内容进行自动审核，具体说明如下：",
    reviewItems: [
      "审核对象包括：上传的代码包、静态资源文件以及对外提供访问的页面内容。",
      "审核技术包括但不限于：图像识别、OCR 文本识别、LOGO 检测、二维码/条形码识别、敏感关键词识别等。",
      "重点审核类别包括：色情内容、政治敏感内容、暴力恐怖内容、违法广告营销、低质和不当内容等，具体范围以《使用协议与服务条款》中「禁止及重点审核内容」一章为准。",
      "审核结果可能导致您的内容被下线、访问受限、项目封禁或账号限制，以保障平台整体安全与合规。",
    ],
    reviewNote:
      "使用 Demox 即表示您理解并同意：内容会被自动审核，审核结果可能影响内容是否可继续对外访问。",
    storeTitle: "四、我们如何存储和保护信息",
    storeLead:
      "我们会采取合理且必要的安全措施保护您的信息，防止数据被未经授权地访问、使用、泄露、篡改或毁损，包括但不限于：",
    storeItems: [
      "使用符合行业标准的安全技术手段和访问控制策略。",
      "对核心系统和数据访问进行权限管理与操作审计。",
      "在符合法律法规和业务需要的前提下，设置合理的数据保存期限，超期的数据将被删除或匿名化处理。",
    ],
    cookieTitle: "五、Cookie 政策",
    cookieItems: [
      "登录使用必要 Cookie，用于保持会话和完成鉴权。",
      "Demox 不使用广告 Cookie，也不出售个人数据。",
      "没有需要单独接受或拒绝的广告追踪 Cookie。",
    ],
    shareTitle: "六、信息共享、转让与公开披露",
    shareLead:
      "我们不会向任何无关第三方出售您的个人信息。仅在以下情形下，我们可能会共享、转让或公开披露相关信息：",
    shareItems: [
      "根据法律法规的规定、行政或司法机关的要求，必须对外提供的情况。",
      "为实现内容审核、存储与加速等必要功能，向受信任的云服务提供商或安全服务提供方共享必要的数据，这些第三方仅在约定目的范围内使用信息。",
      "依法进行的合并、分立、收购或资产转让等情形中，如涉及个人信息转让，我们会要求新的持有方继续受本政策约束，否则将重新征得您的授权同意。",
    ],
    rightsTitle: "七、您的权利",
    rightsLead: "在法律法规允许的范围内，您对自己的个人信息享有以下权利：",
    rightsItems: [
      "访问与更正：您可以在账户设置中查看或更新部分注册信息。",
      "删除：在符合条件时，您可以请求删除部分个人信息或关闭账户。",
      "撤回同意：对于依赖您授权才进行的处理活动，您可以随时撤回授权，但这可能导致部分功能无法继续提供。",
    ],
    rightsNote:
      "当您删除数据、关闭账号或撤回同意后，我们可能仍需在法律要求的保存期限内保留部分信息。",
    thirdTitle: "八、与第三方服务的关系",
    thirdP1:
      "您在 Demox 上部署的站点可能会嵌入第三方服务（如统计工具、第三方脚本、外链资源等）。这些第三方可能会依据其自身的隐私政策收集和处理您的访问者数据，该等行为不由 Demox 控制或负责。",
    thirdP2:
      "当您主动使用飞书登录时，授权页面与身份认证由飞书提供，并受飞书相关服务条款与隐私政策约束；Demox 仅请求完成登录所需的最小用户身份信息。",
    thirdP3:
      "我们建议您在部署前仔细阅读相关第三方服务的隐私政策，并在您自建的站点中向您的最终用户做出必要的隐私说明。",
    minorTitle: "九、未成年人保护",
    minorBody:
      "若您为未成年人，请在监护人同意与指导下使用 Demox 服务。我们不会在明知为未成年人情况下收集其不必要的个人信息。",
    updateTitle: "十、本政策的更新",
    updateBody:
      "随着业务发展或法律法规的变更，我们可能会适时更新本隐私政策。重大变更时，我们会在显著位置提示或通过其他合理方式告知您。更新后的政策一经公布，即适用于所有新的使用行为。",
    contactTitle: "十一、联系我们",
    contactBody:
      "如您对本隐私政策或个人信息保护事宜有任何问题、建议或投诉，可通过 phosa@qq.com 或站内反馈渠道与我们取得联系，我们会尽快予以回复和处理。",
  },
  en: {
    eyebrow: "Privacy Policy",
    title: "Demox Privacy Policy",
    updated: "Last updated: 21 July 2026",
    intro:
      "This policy explains how Demox collects, uses, stores, and protects personal information, including data used for content review.",
    collectTitle: "1. Information we collect",
    collectLead: "We collect only what is lawful, legitimate, and necessary:",
    collectItems: [
      "Account data: email used to register and sign in, a one-way hash of the password, and verification codes.",
      "Third-party login data: if you sign in with Feishu, we store the Feishu user id, name, and avatar to identify the account. We do not store Feishu access tokens.",
      "Usage data: sign-in time, IP address, basic device data, and operation logs for security and service quality.",
      "Deploy data: uploaded archives, static file names such as zip names, project metadata, deploy time, and access stats.",
      "Content-review data: features extracted for automated review, such as image features, OCR text, logos, or QR codes.",
    ],
    useTitle: "2. How we use this information",
    useLead: "We use the information for:",
    useItems: [
      "Account registration, sign-in, identity checks, and basic account services.",
      "Website deploy, storage, CDN delivery, and related support.",
      "Security and compliance, including detecting illegal content, spam, and attacks.",
      "Aggregated, anonymized stats to measure performance and improve the product. We do not sell individual user profiles.",
    ],
    reviewTitle: "3. Automated content review",
    reviewLead:
      "To meet legal and regulatory requirements, we automatically review code you upload and the pages that result:",
    reviewItems: [
      "Review covers uploaded packages, static files, and publicly served pages.",
      "Methods may include image recognition, OCR, logo detection, QR or barcode detection, and keyword matching.",
      "Priority categories include pornography, politically sensitive content, violent or terrorist content, illegal advertising, and other prohibited material, as defined in the Terms of Service.",
      "A review result may take content offline, restrict access, freeze a project, or limit an account.",
    ],
    reviewNote:
      "Using Demox means you understand that content is reviewed automatically, and the result may affect whether it stays public.",
    storeTitle: "4. Storage and protection",
    storeLead:
      "We take reasonable security measures to prevent unauthorized access, use, disclosure, alteration, or destruction, including:",
    storeItems: [
      "Industry-standard technical controls and access policies.",
      "Permission management and audit logs for core systems.",
      "Retention limited to what law and operations require. Data past that period is deleted or anonymized.",
    ],
    cookieTitle: "5. Cookie policy",
    cookieItems: [
      "Login uses essential cookies to keep a session and complete authentication.",
      "Demox does not use advertising cookies and does not sell personal data.",
      "There is no advertising cookie to accept or reject.",
    ],
    shareTitle: "6. Sharing, transfer, and disclosure",
    shareLead:
      "We do not sell personal information to unrelated third parties. We may share, transfer, or disclose information only when:",
    shareItems: [
      "Law, or an administrative or judicial request, requires it.",
      "A trusted cloud or security provider needs the data to review content, store files, or accelerate delivery, and may use it only for that purpose.",
      "A merger, split, acquisition, or asset transfer includes personal data. The new holder must follow this policy, or we will ask for consent again.",
    ],
    rightsTitle: "7. Your rights",
    rightsLead: "Where the law allows, you may:",
    rightsItems: [
      "Access and correct some registration data in account settings.",
      "Ask us to delete some personal data or close the account, when the conditions are met.",
      "Withdraw consent for processing that depends on it. Some features may then stop working.",
    ],
    rightsNote:
      "After deletion, account closure, or withdrawal of consent, we may still keep some records for the period the law requires.",
    thirdTitle: "8. Third-party services",
    thirdP1:
      "Sites you host on Demox may embed third-party tools, scripts, or assets. Those parties may collect visitor data under their own policies. Demox does not control that processing.",
    thirdP2:
      "If you sign in with Feishu, Feishu provides the consent screen and authentication under Feishu terms and privacy rules. Demox requests only the minimum identity data needed to complete login.",
    thirdP3:
      "Read third-party privacy policies before you deploy, and tell your own visitors what your site collects.",
    minorTitle: "9. Children",
    minorBody:
      "If you are a minor, use Demox only with a guardian’s consent and guidance. We do not knowingly collect unnecessary personal data from children.",
    updateTitle: "10. Updates to this policy",
    updateBody:
      "We may update this policy as the product or the law changes. Material changes will be shown prominently or otherwise reasonably notified. The updated policy applies to new use after it is published.",
    contactTitle: "11. Contact",
    contactBody:
      "Questions, requests, or complaints about this policy or personal data can be sent to phosa@qq.com or through in-product feedback. We will respond as soon as we can.",
  },
} as const;

const PrivacyPage: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language === "en" ? "en" : "zh"];

  return (
    <LegalArticle eyebrow={t.eyebrow} title={t.title} updated={t.updated} intro={t.intro}>
      <LegalSection title={t.collectTitle}>
        <LegalP>{t.collectLead}</LegalP>
        <LegalList items={t.collectItems} />
      </LegalSection>
      <LegalSection title={t.useTitle}>
        <LegalP>{t.useLead}</LegalP>
        <LegalList items={t.useItems} />
      </LegalSection>
      <LegalSection title={t.reviewTitle}>
        <LegalP>{t.reviewLead}</LegalP>
        <LegalList items={t.reviewItems} />
        <LegalP>{t.reviewNote}</LegalP>
      </LegalSection>
      <LegalSection title={t.storeTitle}>
        <LegalP>{t.storeLead}</LegalP>
        <LegalList items={t.storeItems} />
      </LegalSection>
      <LegalSection title={t.cookieTitle} id="cookies">
        <LegalList items={t.cookieItems} />
      </LegalSection>
      <LegalSection title={t.shareTitle}>
        <LegalP>{t.shareLead}</LegalP>
        <LegalList items={t.shareItems} />
      </LegalSection>
      <LegalSection title={t.rightsTitle}>
        <LegalP>{t.rightsLead}</LegalP>
        <LegalList items={t.rightsItems} />
        <LegalP>{t.rightsNote}</LegalP>
      </LegalSection>
      <LegalSection title={t.thirdTitle}>
        <LegalP>{t.thirdP1}</LegalP>
        <LegalP>{t.thirdP2}</LegalP>
        <LegalP>{t.thirdP3}</LegalP>
      </LegalSection>
      <LegalSection title={t.minorTitle}>
        <LegalP>{t.minorBody}</LegalP>
      </LegalSection>
      <LegalSection title={t.updateTitle}>
        <LegalP>{t.updateBody}</LegalP>
      </LegalSection>
      <LegalSection title={t.contactTitle}>
        <LegalP>{t.contactBody}</LegalP>
      </LegalSection>
    </LegalArticle>
  );
};

export default PrivacyPage;
