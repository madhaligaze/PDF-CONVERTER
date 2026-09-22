"use client";

import { useEffect, useState } from "react";

import { AutoThemeIcon, MoonIcon, SunIcon } from "@/components/icons";

type Theme = "dark" | "light" | "system";

const LABELS: Record<Theme, string> = { dark: "Тёмная", light: "Светлая", system: "Авто" };

/**
 * Переключатель темы: тёмная → светлая → как в системе.
 *
 * Один на весь продукт. Раньше их было два одинаковых — на стартовом экране и в
 * шапке анализатора, — потому что второй жил внутри контекста разбора выписок.
 * Контекст ему никогда не был нужен: тема — это атрибут на <html> и строка в
 * localStorage, больше ничего.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("theme");
      // Разовая сверка с тем, что уже выставил скрипт в <head> до гидратации.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTheme(stored === "dark" || stored === "light" ? stored : "system");
    } catch {
      /* приватный режим — остаётся «Авто» */
    }
  }, []);

  const cycle = () => {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
    try {
      if (next === "system") {
        localStorage.removeItem("theme");
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      } else {
        localStorage.setItem("theme", next);
        document.documentElement.setAttribute("data-theme", next);
      }
    } catch {
      /* приватный режим — тема не запоминается */
    }
  };

  const Icon = theme === "dark" ? MoonIcon : theme === "light" ? SunIcon : AutoThemeIcon;

  return (
    <button type="button" className="btn-ghost btn-sm" onClick={cycle} title={`Тема: ${LABELS[theme]}`}>
      <Icon size={15} />
      {compact ? null : <span className="only-desktop-inline">{LABELS[theme]}</span>}
    </button>
  );
}
