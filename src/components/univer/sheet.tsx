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
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

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
};

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
  { data, onReady },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
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
      ],
    });
    apiRef.current = univerAPI;
    // `data` берётся прямо из пропа, хотя эффект и с пустыми зависимостями:
    // новая книга приходит не сменой пропа, а пересозданием компонента через
    // `key` у родителя, поэтому значение на монтировании — всегда нужное.
    univerAPI.createWorkbook(data ?? blankWorkbook());
    // `onReady` берётся из пропа по той же причине, что и `data`: компонент
    // монтируется один раз на книгу, новая приходит пересозданием через `key`.
    const detach = onReadyRef.current?.(univerAPI);

    return () => {
      try {
        detach?.();
        univerAPI.dispose();
      } catch {
        /* повторный dispose при быстром размонтировании — не ошибка */
      }
      apiRef.current = null;
    };
    // Монтируется один раз; новая книга приходит через `key` у родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
});
