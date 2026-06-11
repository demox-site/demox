import React from "react";
import { Monitor, Moon, Sun, Check } from "lucide-react";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { useLanguage } from "@/hooks/use-language";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeLabels = {
  zh: { system: "跟随系统", light: "亮色", dark: "暗色", label: "主题" },
  en: { system: "System", light: "Light", dark: "Dark", label: "Theme" },
} as const;

const ICONS: Record<Theme, React.ComponentType<{ size?: number }>> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const ORDER: Theme[] = ["system", "light", "dark"];

export const ThemeToggle: React.FC<{ size?: number }> = ({ size = 16 }) => {
  const { theme, setTheme } = useTheme();
  const { language: lang } = useLanguage();
  const t = themeLabels[lang];
  const ActiveIcon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.label}
          className="text-zinc-400 hover:text-zinc-100 transition-colors flex items-center px-2 py-1 rounded-md hover:bg-zinc-900/50 outline-none"
        >
          <ActiveIcon size={size} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-40 bg-zinc-950/95 backdrop-blur-xl border-zinc-800 text-zinc-400 p-1.5 shadow-2xl"
      >
        {ORDER.map((option) => {
          const Icon = ICONS[option];
          const active = theme === option;
          return (
            <DropdownMenuItem
              key={option}
              onClick={() => setTheme(option)}
              className="cursor-pointer my-0.5 flex items-center justify-between focus:bg-zinc-900 focus:text-zinc-100"
            >
              <span className="flex items-center gap-2">
                <Icon size={16} />
                {t[option]}
              </span>
              {active && <Check size={14} className="text-zinc-100" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
