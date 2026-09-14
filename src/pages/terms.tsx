import React from "react";
import { useLanguage } from "@/hooks/use-language";
import { LegalArticle, LegalList, LegalP, LegalSection } from "@/components/LegalArticle";

const copy = {
  zh: {
    eyebrow: "Terms of Service",
    title: "Demox 使用协议与服务条款",
    updated: "最近更新：2025-12-25",
    intro:
      "使用 Demox 部署和托管您的代码，即表示您已阅读、理解并同意本使用协议与服务条款的全部内容。如果您不同意本条款，请不要注册、登录或使用本服务。",
    scopeTitle: "一、适用范围",
    scopeBody:
      "本协议适用于所有使用 Demox 网站、控制台、API 以及相关产品与服务的用户，包括注册用户和未注册但实际使用服务的访问者。",
    accountTitle: "二、账号注册与登录",
    accountP1:
      "您在注册或登录 Demox 账号时，需要提供真实、准确和完整的注册信息（例如邮箱地址），并保持其持续更新。您应妥善保管账号和密码，并对在该账号下发生的所有行为负责。",
    accountP2:
      "在注册与登录流程中，您必须勾选并同意本《使用协议与服务条款》以及《隐私政策》后方可继续使用服务。",
    reviewTitle: "三、内容自动审核",
    reviewP1:
      "为了保障平台合规、安全运行以及遵守相关法律法规，您上传至 Demox 的代码、静态资源以及通过本平台对外提供访问的页面内容，将被系统自动进行合规性审核。",
    reviewP2Before: "审核方式可能包括但不限于：图像识别、文本 OCR 识别、LOGO 检测、二维码/条形码识别、关键词检测等自动化手段。当前本地规则使用的完整屏蔽词表见",
    reviewP2Link: "内容审核屏蔽词",
    reviewP2After: "，也可通过公开接口查询。",
    reviewP3: "您在此明确知悉并同意：",
    reviewItems: [
      "内容会被自动审核，审核范围包括代码、静态资源以及生成的页面内容。",
      "审核结果可能导致您的站点或部分内容被下线、访问受限、冻结或封禁，严重情形下可导致账号被限制使用。",
      "审核策略会根据法律法规与平台风控策略动态调整，恕不逐一另行通知。",
    ],
    bannedTitle: "四、禁止及重点审核内容",
    bannedLead:
      "您承诺不会利用 Demox 存储、处理、传播任何违反法律法规或本平台规则的内容。系统将重点对以下类型内容进行检测和拦截（包括图像、视频、音频、文本等）：",
    bannedGroups: [
      {
        title: "1. 色情内容",
        items: [
          "含有明显性暗示、低俗性行为展示的内容。",
          "性器官裸露、性行为展示或以性为核心的内容。",
          "性用品相关展示及宣传。",
          "通过 OCR 识别出的涉黄文本信息。",
        ],
      },
      {
        title: "2. 政治内容",
        items: [
          "涉及国家领导人、外国或地区领导人的不当使用或歪曲。",
          "负面政治人物、劣迹艺人等相关违规图库。",
          "各类旗帜、标识、国家象征、中国地图等被不当使用或篡改的内容。",
          "敏感政治事件、煽动性政治言论等敏感信息。",
          "通过 OCR 识别出的涉政文本信息。",
        ],
      },
      {
        title: "3. 暴力恐怖内容",
        items: [
          "血腥场景、尸体等令人不适的内容。",
          "暴力恐怖行为展示或煽动暴力、恐怖活动的内容。",
          "军警制服、大型军事武器、枪支等热武器、刀剑等冷兵器等敏感元素。",
          "爆炸、火灾场景及恐怖组织相关标识。",
          "违法违规物品、违禁品展示或交易信息。",
          "通过 OCR 识别出的涉暴恐文本信息。",
        ],
      },
      {
        title: "4. 广告与营销内容",
        items: [
          "违法广告、欺诈或误导性营销信息。",
          "通过二维码、条形码等形式传播违规内容。",
          "违规 LOGO 使用、品牌滥用或侵权行为。",
          "通过 OCR 识别出的涉及违规营销的文本内容。",
        ],
      },
      {
        title: "5. 低质及其他不当内容",
        items: [
          "严重影响浏览体验的低质画面、模糊画面或异常内容。",
          "宣扬不良价值观、极端行为、危险行为的内容。",
          "法律法规禁止传播的其他内容。",
        ],
      },
    ],
    dutyTitle: "五、用户责任与承诺",
    dutyLead: "您在此确认并承诺：",
    dutyItems: [
      "您对使用 Demox 部署和发布的全部内容（包括代码、图片、文字等）拥有合法权利，或已获得必要的授权。",
      "您对上述内容的合法性、合规性、真实性、完整性承担全部责任。",
      "您不会利用 Demox 进行任何侵权、违法或损害他人权益的行为，包括但不限于著作权、商标权、隐私权等侵权行为。",
    ],
    dutyConfirmLead: "在您上传内容前，我们会进行二次确认。继续上传即表示：",
    dutyConfirm: "You confirm that you have the legal right to publish this content and take full responsibility for it.",
    actionTitle: "六、违规处理",
    actionLead:
      "如我们在自动审核或人工复核过程中发现您的内容可能存在违规情形，Demox 有权根据情节严重程度采取包括但不限于以下一项或多项措施：",
    actionItems: [
      "限制相关内容访问或对站点进行下线处理。",
      "对相关项目进行冻结、封禁或删除。",
      "限制、暂停或终止您账号的部分或全部功能。",
      "根据法律法规的要求，向有关主管部门报告。",
    ],
    disclaimerTitle: "七、免责声明",
    disclaimerLead:
      "由于互联网环境复杂多变，Demox 会在合理范围内采取技术与管理措施保障服务稳定与内容合规，但不对以下情形承担责任：",
    disclaimerItems: [
      "因用户自身原因导致的账号泄露、数据丢失或其他损失，包括但不限于弱密码、终端感染恶意软件等。",
      "因不可抗力或基础网络服务商原因导致的服务中断或访问异常。",
      "第三方对您部署内容的解释、使用或二次传播行为所造成的任何损失或责任。",
    ],
    updateTitle: "八、协议更新",
    updateBody:
      "我们可能会根据业务发展、法律法规变化等不时更新本协议。更新内容将在本页面公示，并自公布之日起生效。您继续使用 Demox 服务，即视为接受更新后的协议。",
    contactTitle: "九、联系我们",
    contactBody:
      "如您对本协议或平台内容审核规则有任何疑问、建议或投诉，可通过 phosa@qq.com 或站内反馈渠道与我们取得联系，我们会尽快进行处理。",
  },
  en: {
    eyebrow: "Terms of Service",
    title: "Demox Terms of Service",
    updated: "Last updated: 25 December 2025",
    intro:
      "By deploying or hosting code with Demox, you confirm that you have read, understood, and agreed to these terms. If you do not agree, do not register, sign in, or use the service.",
    scopeTitle: "1. Scope",
    scopeBody:
      "These terms apply to everyone who uses the Demox website, console, API, or related products, including registered users and visitors who use the service without an account.",
    accountTitle: "2. Accounts",
    accountP1:
      "When you register or sign in, you must provide true, accurate, and complete information such as an email address, and keep it up to date. You must protect the account and password, and you are responsible for activity under that account.",
    accountP2:
      "During registration and sign-in you must accept these Terms of Service and the Privacy Policy before you continue.",
    reviewTitle: "3. Automated content review",
    reviewP1:
      "To keep the platform lawful and safe, code, static files, and pages you publish through Demox are reviewed automatically.",
    reviewP2Before:
      "Review may include image recognition, OCR, logo detection, QR or barcode detection, and keyword matching. The full local blocklist is on the",
    reviewP2Link: "content scan page",
    reviewP2After: ", and is also available through the public API.",
    reviewP3: "You acknowledge and agree that:",
    reviewItems: [
      "Content is reviewed automatically, including code, static files, and generated pages.",
      "A review result may take a site or part of it offline, restrict access, freeze or ban a project, and in serious cases limit the account.",
      "Review rules may change with law and platform risk policy, without individual notice of each change.",
    ],
    bannedTitle: "4. Prohibited and priority-review content",
    bannedLead:
      "You will not use Demox to store, process, or distribute content that breaks the law or these rules. The system will detect and block, among other things:",
    bannedGroups: [
      {
        title: "1. Pornographic content",
        items: [
          "Sexually suggestive or explicit sexual display.",
          "Nudity of sexual organs, sexual acts, or content whose core is sex.",
          "Display or promotion of sex products.",
          "Pornographic text found by OCR.",
        ],
      },
      {
        title: "2. Political content",
        items: [
          "Improper use or distortion of national, foreign, or regional leaders.",
          "Libraries of prohibited political figures or banned public figures.",
          "Improper use or alteration of flags, emblems, national symbols, or maps of China.",
          "Sensitive political events or incitement.",
          "Political text found by OCR.",
        ],
      },
      {
        title: "3. Violent or terrorist content",
        items: [
          "Graphic gore, corpses, or other distressing scenes.",
          "Display of violent or terrorist acts, or incitement of them.",
          "Sensitive items such as military or police uniforms, firearms, and bladed weapons.",
          "Explosions, fires, and terrorist organization marks.",
          "Display or trade of illegal or banned goods.",
          "Violent or terrorist text found by OCR.",
        ],
      },
      {
        title: "4. Advertising and marketing",
        items: [
          "Illegal ads, fraud, or misleading marketing.",
          "Violating content spread through QR codes or barcodes.",
          "Unauthorized logos, brand abuse, or infringement.",
          "Illegal marketing text found by OCR.",
        ],
      },
      {
        title: "5. Low-quality and other prohibited content",
        items: [
          "Content so poor, blurry, or abnormal that it harms the browsing experience.",
          "Promotion of harmful values, extreme acts, or dangerous acts.",
          "Any other content the law forbids.",
        ],
      },
    ],
    dutyTitle: "5. Your responsibilities",
    dutyLead: "You confirm that:",
    dutyItems: [
      "You have the legal right, or the required license, to publish everything you deploy on Demox, including code, images, and text.",
      "You take full responsibility for the legality, compliance, accuracy, and completeness of that content.",
      "You will not use Demox to infringe or break the law, including copyright, trademark, and privacy rights.",
    ],
    dutyConfirmLead: "We ask for a second confirmation before upload. Continuing to upload means:",
    dutyConfirm: "You confirm that you have the legal right to publish this content and take full responsibility for it.",
    actionTitle: "6. Enforcement",
    actionLead:
      "If automated review or a human check finds likely violations, Demox may take one or more of these steps, depending on severity:",
    actionItems: [
      "Restrict access or take the site offline.",
      "Freeze, ban, or delete the related project.",
      "Limit, suspend, or terminate some or all account features.",
      "Report the matter to the competent authority when the law requires it.",
    ],
    disclaimerTitle: "7. Disclaimer",
    disclaimerLead:
      "The internet is unstable. Demox takes reasonable technical and operational steps to keep the service stable and content compliant, but is not liable for:",
    disclaimerItems: [
      "Account leaks, data loss, or other harm caused by the user, including weak passwords or malware on the user’s device.",
      "Outages or access problems caused by force majeure or underlying network providers.",
      "Loss or liability from a third party interpreting, using, or redistributing content you deployed.",
    ],
    updateTitle: "8. Updates",
    updateBody:
      "We may update these terms as the product or the law changes. Updates are posted on this page and take effect when published. Continued use of Demox means you accept the updated terms.",
    contactTitle: "9. Contact",
    contactBody:
      "Questions, suggestions, or complaints about these terms or content-review rules can be sent to phosa@qq.com or through in-product feedback. We will handle them as soon as we can.",
  },
} as const;

const TermsPage: React.FC = () => {
  const { language } = useLanguage();
  const t = copy[language === "en" ? "en" : "zh"];

  return (
    <LegalArticle eyebrow={t.eyebrow} title={t.title} updated={t.updated} intro={t.intro}>
      <LegalSection title={t.scopeTitle}>
        <LegalP>{t.scopeBody}</LegalP>
      </LegalSection>
      <LegalSection title={t.accountTitle}>
        <LegalP>{t.accountP1}</LegalP>
        <LegalP>{t.accountP2}</LegalP>
      </LegalSection>
      <LegalSection title={t.reviewTitle}>
        <LegalP>{t.reviewP1}</LegalP>
        <LegalP>
          {t.reviewP2Before}{" "}
          <a href="/content-scan" className="text-foreground underline underline-offset-4">
            {t.reviewP2Link}
          </a>
          {t.reviewP2After}
        </LegalP>
        <LegalP>{t.reviewP3}</LegalP>
        <LegalList items={t.reviewItems} />
      </LegalSection>
      <LegalSection title={t.bannedTitle}>
        <LegalP>{t.bannedLead}</LegalP>
        {t.bannedGroups.map((group) => (
          <div key={group.title} className="space-y-2 text-sm text-[var(--stitch-muted)]">
            <h3 className="font-semibold text-foreground">{group.title}</h3>
            <LegalList items={group.items} />
          </div>
        ))}
      </LegalSection>
      <LegalSection title={t.dutyTitle}>
        <LegalP>{t.dutyLead}</LegalP>
        <LegalList items={t.dutyItems} />
        <LegalP>{t.dutyConfirmLead}</LegalP>
        <p className="text-sm font-semibold leading-relaxed text-foreground">{t.dutyConfirm}</p>
      </LegalSection>
      <LegalSection title={t.actionTitle}>
        <LegalP>{t.actionLead}</LegalP>
        <LegalList items={t.actionItems} />
      </LegalSection>
      <LegalSection title={t.disclaimerTitle}>
        <LegalP>{t.disclaimerLead}</LegalP>
        <LegalList items={t.disclaimerItems} />
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

export default TermsPage;
