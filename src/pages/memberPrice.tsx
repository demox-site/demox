import React, { useState, useEffect } from "react";
import { Star, Twitter, Megaphone, Check } from "lucide-react";
import { MainLayout } from "@/layouts/MainLayout";

const MemberPrice = () => {
  const [displayedText, setDisplayedText] = useState("");
  const fullText =
    "“我们甚至没有雇佣设计师来设计这个‘价格’页面。因为它是免费的。我们把设计支付页面的时间，都用来优化你的 CDN 速度了。别找了，去部署吧。”";

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
            <div className="p-8 rounded-lg border border-zinc-800 bg-zinc-950/50 flex flex-col">
              <h3 className="text-xl font-bold mb-2">基础版 (Basic)</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-zinc-500 font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  极速部署
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  全球CDN
                </li>
              </ul>
              <button className="w-full py-3 border border-zinc-800 text-zinc-300 rounded-md hover:border-zinc-600 hover:text-zinc-100 transition-colors">
                [ 没钱 ]
              </button>
            </div>

            <div className="p-8 rounded-lg border border-zinc-700 bg-zinc-900/50 flex flex-col relative transform md:-translate-y-4">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-100 text-black text-xs font-bold rounded-full tracking-wider">
                RECOMMENDED
              </div>
              <h3 className="text-xl font-bold mb-2">专业版 (Pro)</h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-zinc-500 font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  包含基础版所有功能
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  你会感觉自己更专业一点
                </li>
              </ul>
              <button className="w-full py-3 bg-zinc-100 text-black font-semibold rounded-md hover:-translate-y-1 transition-transform duration-300 shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                [ 也没钱 ]
              </button>
            </div>

            <div className="p-8 rounded-lg border border-zinc-800 bg-zinc-950/50 flex flex-col">
              <h3 className="text-xl font-bold mb-2">
                尊贵土豪版 (Enterprise)
              </h3>
              <div className="text-4xl font-bold mb-6">
                $0<span className="text-lg text-zinc-500 font-normal">/月</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  包含专业版所有功能
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  我们会在此刻心里默默感谢你
                </li>
                <li className="flex items-center gap-2 text-zinc-400">
                  <Check size={16} className="text-green-400" />
                  除了名字好听没有任何区别
                </li>
              </ul>
              <button className="w-full py-3 border border-zinc-800 text-zinc-300 rounded-md hover:border-zinc-600 hover:text-zinc-100 transition-colors">
                [ 真的没钱 ]
              </button>
            </div>
          </div>

          <div className="py-20 border-t border-zinc-900 border-b mb-20">
            <div className="max-w-3xl mx-auto text-center px-4">
              <p className="text-xl md:text-2xl leading-relaxed font-mono text-zinc-100 min-h-[120px]">
                {displayedText}
                <span className="animate-pulse text-zinc-500">_</span>
              </p>
            </div>
          </div>

          <div className="max-w-4xl mx-auto text-center mb-20">
            <h2 className="text-2xl font-bold mb-12">
              你可以通过以下方式支持我们：
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <a href="#" className="flex flex-col items-center group">
                <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform group-hover:border-zinc-600">
                  <Star className="text-yellow-400" size={32} />
                </div>
                <div className="font-bold mb-2">GitHub Star</div>
                <div className="text-zinc-400 text-sm">
                  汇率：1 Star = 永久免费
                </div>
              </a>

              <a href="#" className="flex flex-col items-center group">
                <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform group-hover:border-zinc-600">
                  <Twitter className="text-blue-400" size={32} />
                </div>
                <div className="font-bold mb-2">Twitter 吐槽</div>
                <div className="text-zinc-400 text-sm">告诉我们哪里做得烂</div>
              </a>

              <a href="#" className="flex flex-col items-center group">
                <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform group-hover:border-zinc-600">
                  <Megaphone className="text-green-400" size={32} />
                </div>
                <div className="font-bold mb-2">向朋友炫耀</div>
                <div className="text-zinc-400 text-sm">
                  即使他们听不懂你在说什么
                </div>
              </a>
            </div>
          </div>

          <div className="text-center pt-10 border-t border-zinc-900">
            <p className="text-zinc-500 text-sm italic">
              “如果非要给我们钱，请把钱拿去买杯咖啡，边喝边写代码。”
            </p>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default MemberPrice;
