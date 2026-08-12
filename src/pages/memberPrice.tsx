import React, { useState, useEffect } from "react";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Star, X, Megaphone, Check } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";
import { useToast } from "@/components/ui";
import { useLanguage } from "@/hooks/use-language";

const pricingTexts = {
  zh: {
    quote:
      "“我们甚至没有雇佣设计师来设计这个‘价格’页面。因为它是免费的。我们把设计支付页面的时间，都用来优化你的 CDN 速度了。别找了，去部署吧。”",
    accountPendingTitle: "暂未创建账号",
    accountPendingDescription: "Demox 的 X 账号还在路上，先去部署点什么吧。",
    perMonth: "/月",
    recommended: "推荐",
    plans: {
      basic: {
        name: "基础版",
        features: ["极速部署", "全球 CDN"],
        action: "[ 没钱 ]",
      },
      pro: {
        name: "专业版",
        features: ["包含基础版所有功能", "你会感觉自己更专业一点"],
        action: "[ 也没钱 ]",
      },
      enterprise: {
        name: "尊贵土豪版",
        features: [
          "包含专业版所有功能",
          "我们会在此刻心里默默感谢你",
          "除了名字好听没有任何区别",
        ],
        action: "[ 真的没钱 ]",
      },
    },
    supportTitle: "你可以通过以下方式支持我们：",
    githubTitle: "GitHub Star",
    githubDescription: "汇率：1 Star = 永久免费",
    xTitle: "X 吐槽",
    xDescription: "告诉我们哪里做得烂",
    shareTitle: "向朋友炫耀",
    shareDescription: "即使他们听不懂你在说什么",
    closingQuote: "“如果非要给我们钱，请把钱拿去买杯咖啡，边喝边写代码。”",
  },
  en: {
    quote:
      "“We didn't even hire a designer for this pricing page. Because it's free. We spent the time we could have used on a checkout page making your CDN faster instead. Stop looking. Go deploy something.”",
    accountPendingTitle: "Account not ready yet",
    accountPendingDescription: "Demox's X account is still on its way. Go deploy something in the meantime.",
    perMonth: "/month",
    recommended: "Recommended",
    plans: {
      basic: {
        name: "Basic",
        features: ["Lightning-fast deployments", "Global CDN"],
        action: "[ No money ]",
      },
      pro: {
        name: "Pro",
        features: ["Everything in Basic", "Feel a little more professional"],
        action: "[ Still no money ]",
      },
      enterprise: {
        name: "Enterprise",
        features: [
          "Everything in Pro",
          "Our heartfelt gratitude",
          "No difference except the fancier name",
        ],
        action: "[ Seriously, no money ]",
      },
    },
    supportTitle: "You can support us in any of these ways:",
    githubTitle: "Star us on GitHub",
    githubDescription: "Exchange rate: 1 star = free forever",
    xTitle: "Roast us on X",
    xDescription: "Tell us what we got wrong",
    shareTitle: "Show off to your friends",
    shareDescription: "Even if they have no idea what you're talking about",
    closingQuote: "“If you insist on giving us money, buy yourself a coffee and write some code while you drink it.”",
  },
} as const;

const MemberPrice = () => {
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = pricingTexts[language];
  const [displayedText, setDisplayedText] = useState("");

  const showAccountPendingToast = () => {
    toast({
      title: t.accountPendingTitle,
      description: t.accountPendingDescription,
    });
  };

  useEffect(() => {
    setDisplayedText("");
    let index = 0;
    const timer = setInterval(() => {
      setDisplayedText(t.quote.slice(0, index + 1));
      index++;
      if (index >= t.quote.length) {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [t.quote]);

  return (
    <MainLayout>
      <div className="pt-12 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-32">
            <div className="p-8 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] backdrop-blur-md flex flex-col">
              <h3 className="text-xl font-bold mb-2">{t.plans.basic.name}</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">{t.perMonth}</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                {t.plans.basic.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-[var(--stitch-muted)]">
                    <Check size={16} className="text-success shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button className="w-full py-3 border border-[var(--stitch-line)] text-[var(--stitch-muted)] rounded-xl hover:border-[var(--stitch-ink)] hover:text-[var(--stitch-ink)] transition-colors">
                {t.plans.basic.action}
              </button>
            </div>

            <div className="p-8 rounded-2xl border border-[var(--stitch-ink)]/30 bg-[var(--stitch-blue-soft)] backdrop-blur-md flex flex-col relative transform md:-translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] text-xs font-bold rounded-full tracking-wider">
                {t.recommended}
              </div>
              <h3 className="text-xl font-bold mb-2">{t.plans.pro.name}</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">{t.perMonth}</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                {t.plans.pro.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-[var(--stitch-muted)]">
                    <Check size={16} className="text-success shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button className="w-full py-3 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] font-semibold rounded-xl hover:opacity-90 transition-opacity">
                {t.plans.pro.action}
              </button>
            </div>

            <div className="p-8 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] backdrop-blur-md flex flex-col">
              <h3 className="text-xl font-bold mb-2">{t.plans.enterprise.name}</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">{t.perMonth}</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                {t.plans.enterprise.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-[var(--stitch-muted)]">
                    <Check size={16} className="text-success shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button className="w-full py-3 border border-[var(--stitch-line)] text-[var(--stitch-muted)] rounded-xl hover:border-[var(--stitch-ink)] hover:text-[var(--stitch-ink)] transition-colors">
                {t.plans.enterprise.action}
              </button>
            </div>
          </div>

          <div className="py-20 border-t border-[var(--stitch-line)] border-b border-[var(--stitch-line)] mb-20">
            <div className="max-w-3xl mx-auto text-center px-4">
              <p className="text-xl md:text-2xl leading-relaxed font-mono text-foreground min-h-[120px]">
                {displayedText}
                <span className="animate-pulse text-[var(--stitch-muted)]">_</span>
              </p>
            </div>
          </div>

          <div className="max-w-4xl mx-auto text-center mb-20">
            <h2 className="text-2xl font-bold mb-12">
              {t.supportTitle}
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <a
                href="https://github.com/demox-site/demox"
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={Star} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">{t.githubTitle}</div>
                <div className="text-[var(--stitch-muted)] text-sm">
                  {t.githubDescription}
                </div>
              </a>

              <button
                type="button"
                onClick={showAccountPendingToast}
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={X} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">{t.xTitle}</div>
                <div className="text-[var(--stitch-muted)] text-sm">{t.xDescription}</div>
              </button>

              <a
                href="https://demox-promo.demox.site/"
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={Megaphone} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">{t.shareTitle}</div>
                <div className="text-[var(--stitch-muted)] text-sm">
                  {t.shareDescription}
                </div>
              </a>
            </div>
          </div>

          <div className="text-center pt-10 border-t border-[var(--stitch-line)]">
            <p className="text-[var(--stitch-muted)] text-sm italic">
              {t.closingQuote}
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default MemberPrice;
