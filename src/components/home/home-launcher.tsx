"use client";

import { useRef } from "react";

import { LiquidStage, type LiquidStageHandle } from "@/components/motion/liquid-stage";
import { IndexList, type IndexEntry } from "@/components/stage/index-list";
import { ThemeToggle } from "@/components/stage/theme-toggle";

const ENTRIES: IndexEntry[] = [
  { key: "analyzer", title: "Анализатор выписок", meta: "PDF · Excel · фото", href: "/analyzer" },
  { key: "services", title: "Сервисы", meta: "Autocall · BBC · Финансы", href: "/services" },
  { key: "tables", title: "Таблицы", meta: "Google Sheets", href: "/web-excel" },
  { key: "history", title: "История", meta: "Прошлые разборы", href: "/history" },
];

/**
 * Стартовый экран: указатель разделов во весь рост на жидкой сцене.
 *
 * Разделов четыре, и они равны, — поэтому экран не содержит ничего, кроме них:
 * ни логотипа, ни приветствия, ни орнамента. Названия набраны так крупно, что
 * сами и есть интерфейс.
 *
 * Фон — жидкая сцена (см. `motion/liquid-stage.tsx`): масса тянется за
 * курсором, а наведение на раздел подтягивает её к строке и разогревает.
 *
 * Порядок входа — из прежнего задания: сначала проявляется фон, потом
 * собирается интерфейс. Экран всегда тёмный, какая бы тема ни стояла, — см.
 * `.home-stage` в globals.css.
 */
export function HomeLauncher() {
  const liquidRef = useRef<LiquidStageHandle>(null);

  const onHover = (row: HTMLElement | null) => {
    const stage = liquidRef.current;
    if (!stage) return;
    if (row) stage.focus(row);
    else stage.release();
  };

  return (
    <div className="home-stage">
      <LiquidStage ref={liquidRef} className="home-liquid" intensity={0.92} />
      <div className="home-veil" aria-hidden="true" />

      <header className="home-top">
        <h1 className="annot">Разделы</h1>
        <ThemeToggle />
      </header>

      <main className="home-main">
        <IndexList entries={ENTRIES} size="hero" delay={0.9} onHover={onHover} label="Разделы" />
      </main>
    </div>
  );
}
