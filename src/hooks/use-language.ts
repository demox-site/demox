import React, { useState, useEffect } from "react";

export type Language = "zh" | "en";

const STORAGE_KEY = "app_language";

interface LanguageContextValue {
  language: Language;
  setLanguage: React.Dispatch<React.SetStateAction<Language>>;
  toggleLanguage: () => void;
}

const LanguageContext = React.createContext<LanguageContextValue | undefined>(
  undefined
);

export const LanguageProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [language, setLanguage] = useState<Language>(() => {
    // 1. 尝试从 localStorage 获取
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") {
      return saved;
    }

    // 2. 尝试从浏览器获取
    if (typeof navigator !== "undefined") {
      const browserLang = navigator.language.toLowerCase();
      if (browserLang.startsWith("zh")) {
        return "zh";
      }
    }
    
    // 3. 默认英文 (作为国际化产品通常的默认值，或者也可以默认中文，这里我选择英文作为兜底，因为中文已经在上面检测了)
    // 不过考虑到之前页面默认是 zh，如果用户浏览器不是中文也不是英文（比如法语），回退到 zh 还是 en？
    // 之前的代码硬编码是 zh。
    // 如果浏览器是 en-US -> en
    // 如果浏览器是 zh-CN -> zh
    // 如果浏览器是 fr-FR -> en (通常)
    return "en"; 
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  const toggleLanguage = () => {
    setLanguage((prev) => (prev === "zh" ? "en" : "zh"));
  };

  const value = React.useMemo(
    () => ({ language, setLanguage, toggleLanguage }),
    [language]
  );

  return React.createElement(LanguageContext.Provider, { value }, children);
};

export function useLanguage() {
  const context = React.useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
