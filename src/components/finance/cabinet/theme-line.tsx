"use client";

import { useSyncExternalStore } from "react";

import { SelectLine } from "@/components/finance/ui/select-line";

/**
 * «Тема» в профиле: Светлая · Тёмная · Как в системе.
 *
 * Логика та же, что у `stage/theme-toggle.tsx`: тема — атрибут на <html> и
 * строка в localStorage. Тема — личная настройка, поэтому она в кабинете.
 */
type Theme = "light" | "dark" | "system";

const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

function write(next: Theme) {
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
    document.documentElement.setAttribute("data-theme", next === "system" ? "light" : next);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function ThemeLine() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <div className="cab-line">
      <span className="cab-line-label">Тема</span>
      <span className="cab-line-value">
        <SelectLine
          items={[
            { key: "light", label: "Светлая" },
            { key: "dark", label: "Тёмная" },
            { key: "system", label: "Как в системе" },
          ]}
          value={theme}
          onChange={write}
          role="radiogroup"
          label="Тема"
          size="sm"
          className="cab-level"
        />
      </span>
    </div>
  );
}
