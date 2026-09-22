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
export function ServicesClient() {
  const [openService, setOpenService] = useState<string | null>(null);

  const entries: IndexEntry[] = [
    {
      key: "autocall",
      title: "Autocall.kz",
      meta: "Обзвоны → Google Sheets",
      onSelect: () => setOpenService("autocall"),
    },
    // BBC Dashboard (removable module)
    { key: "bbc-dashboard", title: "BBC Dashboard", meta: "Сводная таблица", href: "/bbc-dashboard" },
    // Финансы — обкатка управленческого учёта перед интеграцией с Finmap.
    // Строка здесь по делу, в отличие от «Книг»: раздел работает с теми же
    // внешними источниками (выписки банков, выгрузки), а не с нашей копией
    // чужой книги, и открывается он как отдельный продукт.
    { key: "finance", title: "Финансы", meta: "Журнал · отчёты · выписки", href: "/finance" },
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
