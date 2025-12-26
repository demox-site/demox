import React from "react";
import { useNavigate } from "react-router-dom";

const TermsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800 selection:text-white">
      <nav className="border-b border-zinc-800 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => navigate("/index")}
              className="flex items-center gap-2 focus:outline-none"
            >
              <div className="w-5 h-5 bg-zinc-100 rounded-sm flex items-center justify-center">
                <span className="text-black text-xs font-bold">D</span>
              </div>
              <span className="text-lg font-bold tracking-tight">
                Demox<span className="animate-pulse">_</span>
              </span>
            </button>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
            Terms of Service
          </p>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Demox 使用协议与服务条款
          </h1>
          <p className="text-sm text-zinc-500">最近更新：2024-12-25</p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            使用 Demox
            部署和托管您的代码，即表示您已阅读、理解并同意本使用协议与服务
            条款的全部内容。如果您不同意本条款，请不要注册、登录或使用本服务。
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">一、适用范围</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            本协议适用于所有使用 Demox 网站、控制台、API
            以及相关产品与服务的用户，包括
            注册用户和未注册但实际使用服务的访问者。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">二、账号注册与登录</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            您在注册或登录 Demox
            账号时，需要提供真实、准确和完整的注册信息（例如邮箱地
            址），并保持其持续更新。您应妥善保管账号和密码，并对在该账号下发生的所有行
            为负责。
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            在注册与登录流程中，您必须勾选并同意本《使用协议与服务条款》以及《隐私政策》
            后方可继续使用服务。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">三、内容自动审核</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            为了保障平台合规、安全运行以及遵守相关法律法规，您上传至 Demox
            的代码、静态
            资源以及通过本平台对外提供访问的页面内容，将被系统自动进行合规性审核。
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            审核方式可能包括但不限于：图像识别、文本 OCR 识别、LOGO
            检测、二维码/条形码 识别、关键词检测等自动化手段。
          </p>
          <p className="text-sm text-zinc-400 leading-relaxed">
            您在此明确知悉并同意：
          </p>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li>
              内容会被自动审核，审核范围包括代码、静态资源以及生成的页面内容。
            </li>
            <li>
              审核结果可能导致您的站点或部分内容被下线、访问受限、冻结或封禁，严重情形下
              可导致账号被限制使用。
            </li>
            <li>
              审核策略会根据法律法规与平台风控策略动态调整，恕不逐一另行通知。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">四、禁止及重点审核内容</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            您承诺不会利用 Demox
            存储、处理、传播任何违反法律法规或本平台规则的内容。系
            统将重点对以下类型内容进行检测和拦截（包括图像、视频、音频、文本等）：
          </p>

          <div className="space-y-2 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">1. 色情内容</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>含有明显性暗示、低俗性行为展示的内容。</li>
              <li>性器官裸露、性行为展示或以性为核心的内容。</li>
              <li>性用品相关展示及宣传。</li>
              <li>通过 OCR 识别出的涉黄文本信息。</li>
            </ul>
          </div>

          <div className="space-y-2 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">2. 政治内容</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>涉及国家领导人、外国或地区领导人的不当使用或歪曲。</li>
              <li>负面政治人物、劣迹艺人等相关违规图库。</li>
              <li>
                各类旗帜、标识、国家象征、中国地图等被不当使用或篡改的内容。
              </li>
              <li>敏感政治事件、煽动性政治言论等敏感信息。</li>
              <li>通过 OCR 识别出的涉政文本信息。</li>
            </ul>
          </div>

          <div className="space-y-2 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">3. 暴力恐怖内容</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>血腥场景、尸体等令人不适的内容。</li>
              <li>暴力恐怖行为展示或煽动暴力、恐怖活动的内容。</li>
              <li>
                军警制服、大型军事武器、枪支等热武器、刀剑等冷兵器等敏感元素。
              </li>
              <li>爆炸、火灾场景及恐怖组织相关标识。</li>
              <li>违法违规物品、违禁品展示或交易信息。</li>
              <li>通过 OCR 识别出的涉暴恐文本信息。</li>
            </ul>
          </div>

          <div className="space-y-2 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">4. 广告与营销内容</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>违法广告、欺诈或误导性营销信息。</li>
              <li>通过二维码、条形码等形式传播违规内容。</li>
              <li>违规 LOGO 使用、品牌滥用或侵权行为。</li>
              <li>通过 OCR 识别出的涉及违规营销的文本内容。</li>
            </ul>
          </div>

          <div className="space-y-2 text-sm text-zinc-400">
            <h3 className="font-semibold text-zinc-200">
              5. 低质及其他不当内容
            </h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>严重影响浏览体验的低质画面、模糊画面或异常内容。</li>
              <li>宣扬不良价值观、极端行为、危险行为的内容。</li>
              <li>法律法规禁止传播的其他内容。</li>
            </ul>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">五、用户责任与承诺</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            您在此确认并承诺：
          </p>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li>
              您对使用 Demox
              部署和发布的全部内容（包括代码、图片、文字等）拥有合法权利，
              或已获得必要的授权。
            </li>
            <li>您对上述内容的合法性、合规性、真实性、完整性承担全部责任。</li>
            <li>
              您不会利用 Demox
              进行任何侵权、违法或损害他人权益的行为，包括但不限于著作权、
              商标权、隐私权等侵权行为。
            </li>
          </ul>
          <p className="text-sm text-zinc-400 leading-relaxed">
            在您上传内容前，我们会进行二次确认。继续上传即表示：
          </p>
          <p className="text-sm text-zinc-100 leading-relaxed font-semibold">
            You confirm that you have the legal right to publish this content
            and take full responsibility for it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">六、违规处理</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            如我们在自动审核或人工复核过程中发现您的内容可能存在违规情形，Demox
            有权根 据情节严重程度采取包括但不限于以下一项或多项措施：
          </p>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li>限制相关内容访问或对站点进行下线处理。</li>
            <li>对相关项目进行冻结、封禁或删除。</li>
            <li>限制、暂停或终止您账号的部分或全部功能。</li>
            <li>根据法律法规的要求，向有关主管部门报告。</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">七、免责声明</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            由于互联网环境复杂多变，Demox
            会在合理范围内采取技术与管理措施保障服务稳定
            与内容合规，但不对以下情形承担责任：
          </p>
          <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-5">
            <li>
              因用户自身原因导致的账号泄露、数据丢失或其他损失，包括但不限于弱密码、终端
              感染恶意软件等。
            </li>
            <li>因不可抗力或基础网络服务商原因导致的服务中断或访问异常。</li>
            <li>
              第三方对您部署内容的解释、使用或二次传播行为所造成的任何损失或责任。
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">八、协议更新</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            我们可能会根据业务发展、法律法规变化等不时更新本协议。更新内容将在本页面公
            示，并自公布之日起生效。您继续使用 Demox
            服务，即视为接受更新后的协议。
          </p>
        </section>

        <section className="space-y-3 pb-10">
          <h2 className="text-xl font-semibold">九、联系我们</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            如您对本协议或平台内容审核规则有任何疑问、建议或投诉，可通过站内反馈渠道或
            官方联系方式与我们取得联系，我们会尽快进行处理。
          </p>
        </section>
      </main>
    </div>
  );
};

export default TermsPage;
