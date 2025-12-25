import React, { useState, useEffect } from "react";
import { Star, Twitter, Megaphone, Check, X, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";

const MemberPrice = () => {
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-zinc-800">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo - clickable to go home */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => navigate("/")}
            >
              <div className="w-5 h-5 bg-zinc-100 rounded-sm flex items-center justify-center">
                <span className="text-black text-xs font-bold">C</span>
              </div>
              <span className="text-lg font-bold tracking-tight">
                CloudHost<span className="animate-pulse">_</span>
              </span>
            </div>

            {/* Desktop Menu */}
            <div className="hidden md:flex items-center gap-8">
              <button
                onClick={() => navigate("/pricing")}
                className="text-sm text-zinc-100 font-medium transition-colors"
              >
                价格
              </button>
              <button
                onClick={() => navigate("/log")}
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                日志
              </button>
              <button className="px-4 py-2 text-sm font-medium border border-zinc-700 rounded-md hover:bg-zinc-100 hover:text-black hover:border-zinc-100 transition-all duration-300">
                登录
              </button>
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden flex items-center gap-4">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-zinc-400 hover:text-zinc-100"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-b border-zinc-800 bg-black">
            <div className="px-4 py-4 space-y-4">
              <button
                onClick={() => navigate("/pricing")}
                className="block text-sm text-zinc-100 font-medium w-full text-left"
              >
                价格
              </button>
              <button
                onClick={() => navigate("/log")}
                className="block text-sm text-zinc-400 hover:text-zinc-100 w-full text-left"
              >
                Log 日志
              </button>
              <button className="w-full px-4 py-2 text-sm font-medium border border-zinc-700 rounded-md hover:bg-zinc-100 hover:text-black transition-colors">
                登录
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <div className="pt-32 pb-20 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Pricing Cards */}
          <div className="grid md:grid-cols-3 gap-8 mb-32">
            {/* Basic */}
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

            {/* Pro */}
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

            {/* Enterprise */}
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

          {/* Typewriter Section */}
          <div className="py-20 border-t border-zinc-900 border-b mb-20">
            <div className="max-w-3xl mx-auto text-center px-4">
              <p className="text-xl md:text-2xl leading-relaxed font-mono text-zinc-100 min-h-[120px]">
                {displayedText}
                <span className="animate-pulse text-zinc-500">_</span>
              </p>
            </div>
          </div>

          {/* Support Section */}
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

          {/* Footer Note */}
          <div className="text-center pt-10 border-t border-zinc-900">
            <p className="text-zinc-500 text-sm italic">
              “如果非要给我们钱，请把钱拿去买杯咖啡，边喝边写代码。”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemberPrice;
