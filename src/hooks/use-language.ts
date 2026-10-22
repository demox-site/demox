import React, { useState, useEffect } from "react";
import { pageLanguageIsExplicit, readPageLanguage } from "@/lib/embedded-gate-language";

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
    if (typeof window === "undefined") return "en";
    // lang=zh|en 和 /zh/ 路径优先于记住的语言，嵌入式登录门整页只走一种语言。
    return readPageLanguage({
      pathname: window.location.pathname,
      search: window.location.search,
      stored: localStorage.getItem(STORAGE_KEY),
      navigatorLanguage: navigator.language
    });
  });

  useEffect(() => {
    if (typeof window !== "undefined" && pageLanguageIsExplicit(window.location.search)) return;
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
