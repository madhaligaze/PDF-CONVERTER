"use client";

import { useState } from "react";
import Link from "next/link";
import type { ComponentType } from "react";

import { AutocallModal } from "@/components/services/autocall-modal";
import { ArrowLeftIcon } from "@/components/icons";
import {
  AutocallServiceIcon,
  DashboardServiceIcon,
  FinanceServiceIcon,
  SourcesServiceIcon,
} from "@/components/service-icons";

type ServiceTile = {
  key: string;
  title: string;
  description: string;
  Icon: ComponentType<{ size?: number }>;
  /** When set, the tile navigates to this page instead of opening a modal. */
  href?: string;
};

const TILES: ServiceTile[] = [
  {
    key: "autocall",
    title: "Autocall.kz",
    description: "Фактическая стоимость и дата обзвонов → Google Sheets",
    Icon: AutocallServiceIcon,
  },
  // BBC Dashboard (removable module)
  {
    key: "bbc-dashboard",
    title: "BBC Dashboard",
    description: "Интерактивный дашборд по сводной таблице в Google Sheets",
    Icon: DashboardServiceIcon,
    href: "/bbc-dashboard",
  },
  // Финансы — обкатка управленческого учёта перед интеграцией с Finmap.
  // Плитка здесь по делу, в отличие от «Книг»: раздел работает с теми же
  // внешними источниками (выписки банков, выгрузки), а не с нашей копией
  // чужой книги, и открывается он как отдельный продукт.
  {
    key: "finance",
    title: "Финансы",
    description: "Учёт денег: журнал, отчёты, календарь платежей, загрузка выписок",
    Icon: FinanceServiceIcon,
    href: "/finance",
  },
  // Плитки «Книги» здесь нет намеренно. Страница объявляет себя как «внешние
  // сервисы, из которых мы тянем данные», а внутренние книги — не сервис и не
  // источник: это наша копия чужой книги. Плитка стояла тут ровно потому, что
  // тут была сетка плиток, и читалась как новая интеграция неизвестно с чем.
  // Раздел живёт в сайдбаре дашборда, рядом с панелью управления.
];

const TILE_CLASS =
  "group text-left card p-5 transition-colors flex flex-col gap-3.5 hover:bg-[var(--bg-hover)]";

function TileBody({ tile }: { tile: ServiceTile }) {
  return (
    <>
      {/* Плашка нейтральная: насыщенно-синяя делала значок игрушкой. Глубину
          даёт сам значок (duotone), цвет плашке для этого не нужен. */}
      <span className="service-mark">
        <tile.Icon size={26} />
      </span>
      <span className="text-base font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
        {tile.title}
      </span>
      <span className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {tile.description}
      </span>
    </>
  );
}

export function ServicesClient() {
  const [openService, setOpenService] = useState<string | null>(null);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col" style={{ background: "var(--page-bg)" }}>
      <header
        className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 py-2.5 border-b backdrop-blur-md"
        style={{ background: "var(--header-bg)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <Link href="/" className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5" title="На главную">
            <ArrowLeftIcon size={15} />
            <span className="hidden sm:inline">Назад</span>
          </Link>
          <span className="logo-badge logo-badge-quiet">
            <SourcesServiceIcon size={18} />
          </span>
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Сервисы
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-5 py-10">
        <p className="eyebrow mb-2">Интеграции</p>
        <h1 className="text-2xl font-semibold mb-2" style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
          Источники данных
        </h1>
        <p className="text-sm mb-8 max-w-xl" style={{ color: "var(--text-secondary)" }}>
          Внешние сервисы, из которых мы тянем данные для формирования таблиц.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TILES.map((tile) =>
            tile.href ? (
              <Link key={tile.key} href={tile.href} className={TILE_CLASS}>
                <TileBody tile={tile} />
              </Link>
            ) : (
              <button
                key={tile.key}
                type="button"
                onClick={() => setOpenService(tile.key)}
                className={TILE_CLASS}
              >
                <TileBody tile={tile} />
              </button>
            ),
          )}
        </div>
      </main>

      {openService === "autocall" && <AutocallModal onClose={() => setOpenService(null)} />}
    </div>
  );
}
