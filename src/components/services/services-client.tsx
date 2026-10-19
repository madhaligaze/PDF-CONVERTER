"use client";

import { useState } from "react";

import { SplitReveal } from "@/components/motion/split-reveal";
import { AutocallModal } from "@/components/services/autocall-modal";
import { IndexList, type IndexEntry } from "@/components/stage/index-list";
import { SectionBar } from "@/components/stage/section-bar";
import { ThemeToggle } from "@/components/stage/theme-toggle";

/**
 * Сервисы — тот же указатель, что на стартовом экране, только мельче: это
 * второй уровень, и он не должен спорить с первым ростом букв.
 *
 * Подзаголовок «внешние сервисы, из которых мы тянем данные» снят вместе с
 * остальными дежурными пояснениями: пометка у каждой строки говорит то же
 * самое по делу, а общий абзац над ними читали один раз.
 */
export function ServicesClient({ bbcEnabled = true }: { bbcEnabled?: boolean }) {
  const [openService, setOpenService] = useState<string | null>(null);

  const entries: IndexEntry[] = [
    {
      key: "autocall",
      title: "Autocall.kz",
      meta: "Обзвоны → Google Sheets",
      onSelect: () => setOpenService("autocall"),
    },
    // BBC Dashboard (removable module). Выключается переменной бэкенда
    // BBC_DASHBOARD_ENABLED=false — тогда строки нет (см. src/lib/features.ts).
    ...(bbcEnabled
      ? [{ key: "bbc-dashboard", title: "BBC Dashboard", meta: "Сводная таблица", href: "/bbc-dashboard" }]
      : []),
    // Надпись остаётся, сам раздел вынесен в отдельное приложение.
    { key: "finance", title: "Финансы", meta: "Отдельное приложение", disabled: true },
    // Строки «Книги» здесь нет намеренно. Внутренние книги — не сервис и не
    // источник: это наша копия чужой книги. Раздел живёт в сайдбаре дашборда,
    // рядом с панелью управления.
  ];

  return (
    <div className="page-shell">
      <SectionBar>
        <ThemeToggle />
      </SectionBar>

      <main className="page-main">
        <p className="annot">Интеграции</p>
        <SplitReveal as="h1" className="headline-xl">
          Сервисы
        </SplitReveal>
        <div className="page-lead-gap" />
        <IndexList entries={entries} size="section" delay={0.15} label="Сервисы" />
      </main>

      {openService === "autocall" && <AutocallModal onClose={() => setOpenService(null)} />}
    </div>
  );
}
