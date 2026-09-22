"use client";

/**
 * Сайдбар — навигация дашборда на десктопе.
 *
 * Раскрытие сделано целиком на CSS: полоса 56px растёт до 220px по `:hover`, и
 * ни одного обработчика в JS для этого нет. Так же устроен референс в
 * KORT-TESTING-FRONTEND — и это не экономия, а надёжность: состояние «раскрыт»
 * не может разойтись с тем, где на самом деле курсор.
 *
 * Раскрытая панель ложится ПОВЕРХ контента, а не раздвигает его. Место в
 * раскладке держит подложка `.bbc-rail` шириной ровно 56px; всё, что шире,
 * вылезает наружу. Иначе широкие таблицы дебиторки перевёрстывались бы на
 * каждое движение мыши мимо левого края.
 *
 * От референса отличается тремя вещами, и каждая там — недоделка:
 * `:focus-within` (иначе с клавиатуры в сайдбар не войти), видимый фокус
 * (там его гасит `outline: none`), и `title` на пунктах — свёрнутые иконки
 * ничем не подписаны для мыши. Скринридеру подписи доступны всегда: они
 * `opacity: 0`, а не `display: none`, и остаются в дереве доступности.
 */
import type { CSSProperties } from "react";

import { StageLink } from "@/components/motion/stage-transition";

import { BbcDashboardIcon } from "../icon";
import type { BlockDefinition } from "./nav-items";
import { CONTROL_BLOCK } from "./nav-items";

export function Sidebar({
  blocks,
  activeKey,
  warningCount,
  onSelect,
}: {
  blocks: BlockDefinition[];
  activeKey: string | undefined;
  warningCount: number;
  onSelect: (key: string) => void;
}) {
  return (
    // only-desktop, а не hidden sm:block: у .bbc-rail свой display из
    // globals.css, и утилита Tailwind проиграла бы ему по каскаду молча.
    <div className="bbc-rail only-desktop">
      <aside className="bbc-sidebar" aria-label="Разделы">
        {/* Логотип — выход к списку сервисов.
            Раньше это была кнопка «Назад» в шапке, и название врало: читалось
            как шаг назад по истории, а уводило из дашборда целиком. Клик по
            логотипу, ведущий на уровень выше, — то, чего от него и ждут, и
            подпись при раскрытии говорит куда. */}
        <StageLink href="/services" label="Сервисы" className="bbc-sidebar-logo" title="К списку сервисов">
          <span className="bbc-sidebar-glyph">
            <BbcDashboardIcon size={17} />
          </span>
          <span className="bbc-sidebar-label bbc-sidebar-wordmark">BBC</span>
          <span className="bbc-sidebar-label bbc-sidebar-exit">к сервисам</span>
        </StageLink>

        <nav className="bbc-sidebar-nav">
          {blocks.map((item) => (
            <SidebarItem
              key={item.key}
              item={item}
              active={activeKey === item.key}
              badge={item.key === "warnings" ? warningCount : 0}
              onSelect={onSelect}
            />
          ))}
        </nav>
      </aside>
    </div>
  );
}

function SidebarItem({
  item,
  active,
  badge,
  onSelect,
}: {
  item: BlockDefinition;
  active: boolean;
  badge: number;
  onSelect: (key: string) => void;
}) {
  const Icon = item.icon;
  const isControl = item.key === CONTROL_BLOCK.key;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      className="bbc-sidebar-item"
      // Настройки отделены от разделов данных: они не про цифры, а про то,
      // как цифры считаются. В ленте вкладок их прижимало вправо — здесь вниз.
      data-pinned={isControl ? "" : undefined}
      aria-current={active ? "page" : undefined}
      title={item.title}
    >
      <span className="bbc-sidebar-glyph">
        <Icon size={17} />
        {badge ? <BadgeDot count={badge} /> : null}
      </span>
      <span className="bbc-sidebar-label">{item.short}</span>
      {/* Счётчик в раскрытом виде — числом у правого края, как в списке. */}
      {badge ? <span className="bbc-sidebar-label bbc-sidebar-count">{compact(badge)}</span> : null}
    </button>
  );
}

/**
 * Счётчик поверх иконки — то, что видно в свёрнутой полосе.
 *
 * Это количество, а не индикатор состояния: он есть, только когда
 * предупреждения есть, и исчезает вместе с ними. Постоянно горящего значка
 * «всё хорошо» здесь нет и быть не может.
 *
 * В раскрытой полосе гаснет (CSS): там то же число стоит у правого края
 * подписью, и два одинаковых числа в одной строке читались бы как две разные
 * величины.
 */
function BadgeDot({ count }: { count: number }) {
  return (
    <span
      className="bbc-num bbc-sidebar-badge"
      style={
        {
          position: "absolute",
          top: -5,
          left: "calc(50% + 3px)",
          minWidth: 15,
          height: 15,
          padding: "0 4px",
          borderRadius: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.5625rem",
          lineHeight: 1,
          background: "var(--accent-rose)",
          color: "var(--accent-fg)",
        } as CSSProperties
      }
    >
      {compact(count)}
    </span>
  );
}

function compact(count: number): string {
  return count > 99 ? "99+" : String(count);
}
