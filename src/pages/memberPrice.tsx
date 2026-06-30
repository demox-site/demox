import React, { useState, useEffect } from "react";
import { FeatureIcon } from "@/components/ui/feature-icon";
import { Star, X, Megaphone, Check } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";
import { useToast } from "@/components/ui";

const MemberPrice = () => {
  const { toast } = useToast();
  const [displayedText, setDisplayedText] = useState("");
  const fullText =
    "“我们甚至没有雇佣设计师来设计这个‘价格’页面。因为它是免费的。我们把设计支付页面的时间，都用来优化你的 CDN 速度了。别找了，去部署吧。”";

  const showAccountPendingToast = () => {
    toast({
      title: "暂未创建账号",
      description: "Demox 的 X 账号还在路上，先去部署点什么吧。",
    });
  };

  useEffect(() => {
    let index = 0;
    const timer = setInterval(() => {
      setDisplayedText(fullText.slice(0, index + 1));
      index++;
      if (index >= fullText.length) {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <MainLayout>
      <div className="pt-12 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-32">
            <div className="p-8 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] backdrop-blur-md flex flex-col">
              <h3 className="text-xl font-bold mb-2">基础版 (Basic)</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  极速部署
                </li>
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  全球CDN
                </li>
              </ul>
              <button className="w-full py-3 border border-[var(--stitch-line)] text-[var(--stitch-muted)] rounded-xl hover:border-[var(--stitch-ink)] hover:text-[var(--stitch-ink)] transition-colors">
                [ 没钱 ]
              </button>
            </div>

            <div className="p-8 rounded-2xl border border-[var(--stitch-ink)]/30 bg-[var(--stitch-blue-soft)] backdrop-blur-md flex flex-col relative transform md:-translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] text-xs font-bold rounded-full tracking-wider">
                RECOMMENDED
              </div>
              <h3 className="text-xl font-bold mb-2">专业版 (Pro)</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  包含基础版所有功能
                </li>
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  你会感觉自己更专业一点
                </li>
              </ul>
              <button className="w-full py-3 bg-[var(--stitch-ink)] text-[var(--stitch-surface)] font-semibold rounded-xl hover:opacity-90 transition-opacity">
                [ 也没钱 ]
              </button>
            </div>

            <div className="p-8 rounded-2xl border border-[var(--stitch-line)] bg-[var(--stitch-surface)] backdrop-blur-md flex flex-col">
              <h3 className="text-xl font-bold mb-2">
                尊贵土豪版 (Enterprise)
              </h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-[var(--stitch-muted)] font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  包含专业版所有功能
                </li>
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  我们会在此刻心里默默感谢你
                </li>
                <li className="flex items-center gap-2 text-[var(--stitch-muted)]">
                  <Check size={16} className="text-success shrink-0" />
                  除了名字好听没有任何区别
                </li>
              </ul>
              <button className="w-full py-3 border border-[var(--stitch-line)] text-[var(--stitch-muted)] rounded-xl hover:border-[var(--stitch-ink)] hover:text-[var(--stitch-ink)] transition-colors">
                [ 真的没钱 ]
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
              你可以通过以下方式支持我们：
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <a
                href="https://github.com/demox-site/demox"
                target="_blank"
                rel="noreferrer"
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={Star} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">GitHub Star</div>
                <div className="text-[var(--stitch-muted)] text-sm">
                  汇率：1 Star = 永久免费
                </div>
              </a>

              <button
                type="button"
                onClick={showAccountPendingToast}
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={X} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">X 吐槽</div>
                <div className="text-[var(--stitch-muted)] text-sm">告诉我们哪里做得烂</div>
              </button>

              <a
                href="https://demox-promo.demox.site/"
                className="flex flex-col items-center group"
              >
                <FeatureIcon icon={Megaphone} className="mb-4 group-hover:scale-105 transition-transform" />
                <div className="font-bold mb-2">向朋友炫耀</div>
                <div className="text-[var(--stitch-muted)] text-sm">
                  即使他们听不懂你在说什么
                </div>
              </a>
            </div>
          </div>

          <div className="text-center pt-10 border-t border-[var(--stitch-line)]">
            <p className="text-[var(--stitch-muted)] text-sm italic">
              “如果非要给我们钱，请把钱拿去买杯咖啡，边喝边写代码。”
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default MemberPrice;
