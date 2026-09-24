"use client";

import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreRuRU from "@univerjs/preset-sheets-core/locales/ru-RU";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortRuRU from "@univerjs/preset-sheets-sort/locales/ru-RU";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterRuRU from "@univerjs/preset-sheets-filter/locales/ru-RU";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingRuRU from "@univerjs/preset-sheets-conditional-formatting/locales/ru-RU";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationRuRU from "@univerjs/preset-sheets-data-validation/locales/ru-RU";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceRuRU from "@univerjs/preset-sheets-find-replace/locales/ru-RU";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import UniverPresetSheetsNoteRuRU from "@univerjs/preset-sheets-note/locales/ru-RU";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import UniverPresetSheetsHyperLinkRuRU from "@univerjs/preset-sheets-hyper-link/locales/ru-RU";
import { UniverSheetsTablePreset } from "@univerjs/preset-sheets-table";
import UniverPresetSheetsTableRuRU from "@univerjs/preset-sheets-table/locales/ru-RU";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import UniverPresetSheetsThreadCommentRuRU from "@univerjs/preset-sheets-thread-comment/locales/ru-RU";
import { UniverSheetsDrawingPreset } from "@univerjs/presets/preset-sheets-drawing";
import UniverPresetSheetsDrawingRuRU from "@univerjs/presets/preset-sheets-drawing/locales/ru-RU";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { isDarkTheme } from "@/components/univer/sheet-model";
import { registerRuNumfmtLocale } from "@/components/web-excel/numfmt-locale";

import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import "@univerjs/presets/lib/styles/preset-sheets-drawing.css";

/** Снимок книги в формате Univer (`IWorkbookData`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkbookSnapshot = Record<string, any>;

export type UniverSheetHandle = {
  /** Текущее состояние книги целиком — то, что уходит в сохранение. */
  snapshot: () => WorkbookSnapshot | null;
};

/** Фасад Univer. Типы пакета сюда не тянем — они огромны и меняются от версии. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UniverApi = any;

type Props = {
  /** Книга. `null` — пустая таблица «с нуля». */
  data: WorkbookSnapshot | null;
  /**
   * Фасад готов, книга создана.
   *
   * Через него подписываются на правки и раздают права. Возвращённая функция
   * вызывается при размонтировании — ею снимают подписки, иначе второй заход
   * в раздел получит их вдвое.
   */
  onReady?: (api: UniverApi) => void | (() => void);
  /**
   * Комментарии к ячейкам и картинки на листе.
   *
   * Только там, где книга хранится снимком целиком («Таблицы»): и то и другое
   * Univer держит в ресурсах снимка. В «Финансах» и «Книгах» строки живут в
   * базе, снимка нет — комментарий, оставленный там, пропал бы при перезагрузке.
   */
  extras?: boolean;
  /** Кнопка «На весь экран» в ленте. По умолчанию есть у каждого листа. */
  fullscreen?: boolean;
};

/**
 * Всё, что общее у листов продукта, живёт здесь, а не в разделах.
 *
 * Лист журнала, «Реестр · таблица», «Таблицы» и «Книги» — один и тот же
 * компонент. Раньше тему умел только лист реестра (своим адаптером), кнопку
 * «На весь экран» — только журнал (своей пилюлей поверх ленты), и каждое
 * улучшение приходилось повторять в каждом разделе. Теперь:
 *
 * * **тема** — лист идёт за `data-theme` приложения и за системной темой
 *   («Как в системе»); тёмный класс Univer снимается при уходе, иначе
 *   следующий светлый лист получил бы тёмную ленту;
 * * **«На весь экран»** — вкладкой прямо в ряду вкладок ленты, с классами
 *   соседней вкладки Univer: шрифт, отступы, наведение и тёмная тема у неё
 *   те же, что у «Начало» и «Вставки». Esc сворачивает; страница под листом
 *   не прокручивается.
 */
const FULL_TEXT = "На весь экран";
const COLLAPSE_TEXT = "Свернуть";

/** Ряд вкладок ленты: элемент шапки Univer, у которого три и больше кнопок-детей. */
function findTabRow(root: HTMLElement): HTMLElement | null {
  const header = root.querySelector("header");
  if (!header) return null;
  for (const node of Array.from(header.querySelectorAll<HTMLElement>("div"))) {
    const buttons = Array.from(node.children).filter((child) => child.tagName === "BUTTON");
    if (buttons.length >= 3) return node;
  }
  return null;
}

/** Классы вкладки, которая сейчас не выбрана: у выбранной свои цвет и вес. */
function idleTabClass(row: HTMLElement): string {
  const buttons = Array.from(row.children).filter(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement && !child.dataset.usheetFull,
  );
  const idle =
    buttons.find((button) => Number(getComputedStyle(button).fontWeight) < 600) ?? buttons[buttons.length - 1];
  return idle?.className ?? "";
}

/**
 * Пустая книга: один лист, столько же строк и колонок, сколько даёт новый
 * документ Google Sheets. Числа не круглые, потому что скопированы у него —
 * человек, переехавший из Sheets, не должен упереться в другую границу.
 */
export function blankWorkbook(name = "Новая таблица"): WorkbookSnapshot {
  return {
    id: `blank-${Date.now()}`,
    name,
    locale: LocaleType.RU_RU,
    sheetOrder: ["sheet-1"],
    styles: {},
    sheets: {
      "sheet-1": {
        id: "sheet-1",
        name: "Лист1",
        rowCount: 1000,
        columnCount: 26,
        cellData: {},
      },
    },
  };
}

export const UniverSheet = forwardRef<UniverSheetHandle, Props>(function UniverSheet(
  { data, onReady, extras = false, fullscreen = true },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  /** Узел в ряду вкладок ленты, куда порталом встаёт «На весь экран». */
  const [tabSlot, setTabSlot] = useState<{ host: HTMLElement; className: string } | null>(null);
  // Через ref, чтобы обработчик, пересозданный родителем, не пересоздавал
  // книгу: эффект ниже монтируется один раз и живёт до размонтирования.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () => {
        const api = apiRef.current;
        if (!api) return null;
        try {
          return api.getActiveWorkbook()?.save() ?? null;
        } catch {
          return null;
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    // До создания книги: первая же отрисовка уже форматирует числа, и локаль,
    // зарегистрированная после неё, до этих ячеек не дойдёт.
    registerRuNumfmtLocale();
    const { univerAPI } = createUniver({
      locale: LocaleType.RU_RU,
      locales: {
        [LocaleType.RU_RU]: mergeLocales(
          UniverPresetSheetsCoreRuRU,
          UniverPresetSheetsSortRuRU,
          UniverPresetSheetsFilterRuRU,
          UniverPresetSheetsConditionalFormattingRuRU,
          UniverPresetSheetsDataValidationRuRU,
          UniverPresetSheetsFindReplaceRuRU,
          UniverPresetSheetsNoteRuRU,
          UniverPresetSheetsHyperLinkRuRU,
          UniverPresetSheetsTableRuRU,
          ...(extras ? [UniverPresetSheetsThreadCommentRuRU, UniverPresetSheetsDrawingRuRU] : []),
        ),
      },
      presets: [
        UniverSheetsCorePreset({ container: containerRef.current }),
        UniverSheetsSortPreset(),
        UniverSheetsFilterPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset(),
        UniverSheetsFindReplacePreset(),
        UniverSheetsNotePreset(),
        UniverSheetsHyperLinkPreset(),
        UniverSheetsTablePreset(),
        ...(extras ? [UniverSheetsThreadCommentPreset(), UniverSheetsDrawingPreset()] : []),
      ],
    });
    apiRef.current = univerAPI;
    // Тема — до книги: первая отрисовка уже в нужных цветах, без вспышки.
    const retheme = () => {
      try {
        univerAPI.toggleDarkMode?.(isDarkTheme());
      } catch {
        /* версия без тёмной темы — лист останется светлым */
      }
    };
    retheme();
    // `data` берётся прямо из пропа, хотя эффект и с пустыми зависимостями:
    // новая книга приходит не сменой пропа, а пересозданием компонента через
    // `key` у родителя, поэтому значение на монтировании — всегда нужное.
    univerAPI.createWorkbook(data ?? blankWorkbook());
    // `onReady` берётся из пропа по той же причине, что и `data`: компонент
    // монтируется один раз на книгу, новая приходит пересозданием через `key`.
    const detach = onReadyRef.current?.(univerAPI);

    // Смена темы в приложении — атрибут `data-theme`; «Как в системе» — ещё и
    // системная настройка, которая меняется без атрибута.
    const themeObserver = new MutationObserver(retheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    system?.addEventListener?.("change", retheme);

    return () => {
      themeObserver.disconnect();
      system?.removeEventListener?.("change", retheme);
      try {
        detach?.();
        univerAPI.dispose();
      } catch {
        /* повторный dispose при быстром размонтировании — не ошибка */
      }
      // Univer вешает тёмный класс на <html> и сам его не снимает.
      document.documentElement.classList.remove("univer-dark");
      apiRef.current = null;
    };
    // Монтируется один раз; новая книга приходит через `key` у родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Вкладка «На весь экран» в ряду вкладок ленты. Лента рисуется Univer после
  // создания книги и может перерисоваться (смена листа, права) — наблюдатель
  // возвращает узел на место, если его выкинули.
  useEffect(() => {
    const root = containerRef.current;
    if (!fullscreen || !root) return;
    let host: HTMLElement | null = null;
    const attach = () => {
      // Дешёвая проверка первой: Univer меняет DOM листа постоянно (редактор
      // ячейки, всплывающие списки), а узел на месте почти всегда.
      if (host?.isConnected && host.parentElement?.firstElementChild === host) return;
      const row = findTabRow(root);
      if (!row) return;
      if (!host) {
        host = document.createElement("span");
        host.style.display = "contents";
        host.dataset.usheetSlot = "true";
      }
      row.insertBefore(host, row.firstChild);
      setTabSlot({ host, className: idleTabClass(row) });
    };
    const frame = requestAnimationFrame(attach);
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host?.remove();
      setTabSlot(null);
    };
  }, [fullscreen]);

  useEffect(() => {
    // Univer меряет холст по событию resize: без толчка после смены размера
    // лист остаётся прежней ширины внутри нового окна.
    const nudge = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    if (!full) return () => window.clearTimeout(nudge);
    // Пока лист во весь экран, страница под ним не едет: колесо двигает
    // таблицу, а не то, что осталось снизу.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(nudge);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  return (
    <div className="usheet" data-full={full ? "true" : undefined}>
      <div ref={containerRef} className="usheet-canvas" />
      {tabSlot
        ? createPortal(
            <button
              type="button"
              data-usheet-full="true"
              className={tabSlot.className}
              aria-pressed={full}
              onClick={(event) => {
                setFull((was) => !was);
                // После клика мышью кольцо фокуса Univer оставалось на кнопке
                // рамкой; с клавиатуры (detail = 0) фокус остаётся, где был.
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              {full ? COLLAPSE_TEXT : FULL_TEXT}
            </button>,
            tabSlot.host,
          )
        : null}
    </div>
  );
});
