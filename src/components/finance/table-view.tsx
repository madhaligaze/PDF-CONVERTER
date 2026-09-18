"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UniverSheet, type UniverApi, type WorkbookSnapshot } from "@/components/univer/sheet";
import { useFillHeight } from "@/components/books/use-fill-height";
import { type GridPayload, financeApi } from "@/components/finance/api";

/**
 * Журнал как лист Univer — второй вид на те же операции.
 *
 * Почему именно Univer, а не своя решётка
 * ───────────────────────────────────────
 * Это уже решалось в разделе «Книги» в сентябре 2026 и стоило переписанного
 * компонента. Своя решётка была: виртуализированная, с правкой по ячейке,
 * пустой строкой внизу, и она проходила все проверки. А человек из Excel
 * приходит с привычками — выделить диапазон и увидеть сумму, потянуть за угол,
 * вставить столбец из буфера, Ctrl+Z, — и ни одной из них она не отвечала.
 * Догонять по одной значит писать Univer заново и хуже.
 *
 * Разметка листа
 * ──────────────
 * Строка 0 — заголовки. Дальше операции в порядке журнала (новые сверху). Под
 * последней — запас пустых строк: новую операцию заводят, спустившись вниз и
 * напечатав, а не кнопкой.
 *
 * Колонка — поле операции по порядку из ответа сервера. Позиция колонки не
 * адрес: адрес — это `key`, и правка уходит по нему. То же правило, что для
 * колонок книг, и по той же причине.
 */

/** Сколько пустых строк держать под последней операцией. */
const SPARE_ROWS = 100;
const HEADER_ROW = 0;

/**
 * Префикс `[$-419]` — русская локаль ПРЯМО В ОБРАЗЦЕ формата.
 *
 * Движок форматов Univer берёт локаль не из книги, а из самого образца. Без
 * префикса тот же `#,##0.00` даёт «95,323.00» вместо «95 323,00»: цифры на
 * месте, разделители чужие — худший вид расхождения, потому что число
 * выглядит правильным.
 */
const RU = "[$-419]";

/** Эпоха дат Excel. Полдень не добавляем: он округляет дату вверх. */
const EPOCH = Date.UTC(1899, 11, 30);

function serialOf(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(at) ? Math.round((at - EPOCH) / 86400000) : null;
}

function dateOf(serial: number): string {
  const at = new Date(EPOCH + Math.round(serial) * 86400000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

function buildWorkbook(payload: GridPayload): WorkbookSnapshot {
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};

  const head: Record<number, Record<string, unknown>> = {};
  payload.columns.forEach((column, index) => {
    head[index] = { v: column.title, s: "head" };
  });
  cellData[HEADER_ROW] = head;

  payload.rows.forEach((row, index) => {
    const line: Record<number, Record<string, unknown>> = {};
    payload.columns.forEach((column, columnIndex) => {
      const raw = row.cells[column.key] ?? "";
      if (!raw) return;
      if (column.kind === "money") {
        const asNumber = Number(String(raw).replace(/\s/g, "").replace(",", "."));
        line[columnIndex] = Number.isFinite(asNumber)
          ? { v: asNumber, s: "money" }
          : { v: String(raw) };
        return;
      }
      if (column.kind === "date") {
        const serial = serialOf(String(raw));
        line[columnIndex] = serial === null ? { v: String(raw) } : { v: serial, t: 2, s: "date" };
        return;
      }
      line[columnIndex] = column.editable ? { v: String(raw) } : { v: String(raw), s: "readonly" };
    });
    if (Object.keys(line).length) cellData[index + 1] = line;
  });

  const columnData: Record<number, { w: number }> = {};
  payload.columns.forEach((column, index) => {
    columnData[index] = { w: column.width };
  });

  return {
    id: `finance-journal`,
    name: "Журнал",
    locale: "ruRU",
    sheetOrder: ["journal"],
    styles: {
      head: {
        bl: 1,
        bg: { rgb: "#f1f3f5" },
        vt: 2,
        bd: { b: { s: 1, cl: { rgb: "#c9ced6" } } },
      },
      money: { ht: 3, n: { pattern: `${RU}#,##0.00` } },
      date: { n: { pattern: `${RU}DD.MM.YYYY` } },
      // Нередактируемые колонки серым: правка в них не сохранится, и человек
      // обязан понять это до того, как напечатает.
      readonly: { cl: { rgb: "#8b8f98" } },
    },
    sheets: {
      journal: {
        id: "journal",
        name: "Журнал",
        rowCount: payload.rows.length + SPARE_ROWS + 1,
        columnCount: Math.max(payload.columns.length, 1),
        cellData,
        columnData,
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      },
    },
  };
}

/**
 * Выпадающие списки на колонках-справочниках.
 *
 * Это то, чего нашей таблице не хватало по сравнению с Google Sheets: в книге
 * «Журнал ГК BBC» у колонок «Счёт», «Подкатегория» и прочих стоят списки, и
 * человек не печатает названия руками, а выбирает. Печать руками — это
 * опечатки, а опечатка в названии статьи создаёт вторую статью и делит отчёт
 * надвое.
 *
 * Список — подсказка, а не запрет. Новая статья появляется в работе постоянно,
 * и запретить ввести её значило бы заставить идти в справочник посреди
 * заполнения. Счёт — исключение, но его строгость обеспечивает сервер: он
 * откажет с объяснением, а не создаст счёт из опечатки.
 */
async function applyDropdowns(api: UniverApi, payload: GridPayload): Promise<void> {
  const sheet = api.getActiveWorkbook?.()?.getActiveSheet?.();
  if (!sheet || typeof api.newDataValidation !== "function") return;
  const rows = payload.rows.length + SPARE_ROWS;

  for (let index = 0; index < payload.columns.length; index += 1) {
    const column = payload.columns[index];
    if (column.kind !== "enum" || !column.source) continue;
    const list = payload.options?.[column.source] ?? [];
    if (!list.length) continue;
    try {
      const rule = api
        .newDataValidation()
        .requireValueInList(list, false, true)
        .setOptions({ allowBlank: true, showErrorMessage: false })
        .build();
      await sheet.getRange(1, index, rows, 1).setDataValidation(rule);
    } catch {
      // Список — удобство, а не условие работы листа: не собрался — значит
      // человек печатает руками, как и раньше.
    }
  }
}

type Beat = { text: string; at: number };

export function TableView({ onChanged }: { onChanged: () => void }) {
  const [payload, setPayload] = useState<GridPayload | null>(null);
  const [error, setError] = useState("");
  const [beat, setBeat] = useState<Beat | null>(null);
  const { ref: box, height } = useFillHeight(360, 44);
  /**
   * Свежие данные держим и в ref: обработчик правки живёт внутри Univer и
   * пересоздаваться не должен — иначе подписка навесится повторно и одна
   * правка уедет на сервер дважды.
   */
  const state = useRef<GridPayload | null>(null);
  state.current = payload;

  const load = useCallback(async () => {
    try {
      const next = await financeApi.grid({});
      setPayload(next);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Лист не собрался");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const say = useCallback((text: string) => setBeat({ text, at: Date.now() }), []);

  const save = useCallback(
    async (sheetRow: number, sheetColumn: number, cell: unknown) => {
      const data = state.current;
      if (!data) return;
      const column = data.columns[sheetColumn];
      if (!column) return;

      const raw = ((): unknown => {
        if (cell === null || cell === undefined) return "";
        const value = typeof cell === "object" ? (cell as { v?: unknown }).v ?? "" : cell;
        // Дата вернулась номером дня — переводим обратно, иначе на сервер
        // уехало бы «46174», и следующее чтение показало бы сорок шесть тысяч.
        if (column.kind === "date" && typeof value === "number") return dateOf(value);
        return value;
      })();

      const index = sheetRow - 1;
      const row = data.rows[index];

      try {
        if (row) {
          if (!column.editable) {
            say(`«${column.title}» правится в карточке операции`);
            await load();
            return;
          }
          await financeApi.patchCell({
            operation_id: row.id,
            column: column.key,
            value: raw,
            version: row.version,
          });
          say(`строка ${sheetRow}: записано`);
        } else {
          // Печать в пустой строке — заводим операцию из того, что в ней уже
          // есть. Пока данных не хватает, сервер откажет с объяснением, и оно
          // покажется строкой состояния: это нормальный ход заполнения, а не
          // ошибка.
          const cells: Record<string, unknown> = {};
          data.columns.forEach((item, itemIndex) => {
            if (itemIndex === sheetColumn) cells[item.key] = raw;
          });
          if (!Object.values(cells).some((value) => String(value ?? "").trim())) return;
          await financeApi.addGridRow(cells);
          say("операция заведена");
        }
        onChanged();
        await load();
      } catch (exc) {
        const text = exc instanceof Error ? exc.message : "Правка не сохранилась";
        say(text);
        // Лист откатываем перечитыванием: оставить на экране значение, которое
        // сервер не принял, — значит показать цифру, которой нет в учёте.
        await load();
      }
    },
    [load, onChanged, say],
  );

  const onReady = useCallback(
    (api: UniverApi) => {
      const disposers: Array<() => void> = [];
      const current = state.current;
      if (current) void applyDropdowns(api, current);
      const values = api.addEvent?.(
        api.Event.SheetValueChanged,
        (event: { effectedRanges?: Array<{ getRow: () => number; getColumn: () => number }> }) => {
          const sheet = api.getActiveWorkbook()?.getActiveSheet();
          if (!sheet) return;
          for (const range of event.effectedRanges ?? []) {
            const row = range.getRow();
            const column = range.getColumn();
            if (row === HEADER_ROW) continue; // заголовки листа не правятся
            const cell = sheet.getRange(row, column, 1, 1).getCellData?.();
            void save(row, column, cell);
          }
        },
      );
      if (values?.dispose) disposers.push(() => values.dispose());
      return () => disposers.forEach((stop) => stop());
    },
    [save],
  );

  const workbook = useMemo(() => (payload ? buildWorkbook(payload) : null), [payload]);

  /** Лист во весь экран. */
  const [full, setFull] = useState(false);
  /**
   * Где стоит кнопка раскрытия: вплотную слева от вкладки «Начало».
   *
   * Считается по разметке Univer, потому что лента у них центрирована: ширина
   * группы вкладок зависит от языка и версии, и зашитое смещение попало бы то
   * на «Начало», то в пустоту.
   */
  const [fullLeft, setFullLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!full) return;
    // Пока лист во весь экран, страница под ним не едет: прокрутка колесом
    // должна двигать таблицу, а не то, что осталось снизу.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  useEffect(() => {
    // Univer меряет холст сам, но только по событию: без толчка после смены
    // размера лист остаётся прежней ширины внутри нового окна.
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => window.clearTimeout(id);
  }, [full]);

  useEffect(() => {
    const place = () => {
      const root = box.current;
      if (!root) return;
      const tab = Array.from(root.querySelectorAll<HTMLElement>("div, span, a, button")).find(
        (node) => node.childElementCount === 0 && node.textContent?.trim() === "Начало",
      );
      if (!tab) {
        setFullLeft(null);
        return;
      }
      const left = tab.getBoundingClientRect().left - root.getBoundingClientRect().left;
      // 132px — ширина кнопки с отступом. Меньше зазора не оставляем: кнопка,
      // прижатая к вкладке, читается как ещё одна вкладка ленты.
      setFullLeft(Math.max(8, Math.round(left - 132)));
    };
    const id = window.setTimeout(place, 400);
    const slower = window.setTimeout(place, 1600);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(slower);
      window.removeEventListener("resize", place);
    };
  }, [full, payload]);

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
      <div className="fin-sheet-wrap" data-full={full ? "true" : undefined}>
        <div className="fin-sheet" ref={box} style={{ height: full ? "100%" : height }}>
          {workbook ? (
            <UniverSheet key={`journal|${payload?.rows.length ?? 0}`} data={workbook} onReady={onReady} />
          ) : null}
        </div>
        {/* Кнопка лежит поверх ленты Univer, а не внутри неё: вставлять свои
            узлы в чужую разметку значит ломаться на каждом их обновлении.
            Положение считается по вкладке «Начало» — см. эффект выше. */}
        <button
          type="button"
          className="fin-full-btn"
          data-full={full ? "true" : undefined}
          style={fullLeft === null ? undefined : { left: `${fullLeft}px` }}
          onClick={() => setFull((was) => !was)}
        >
          {full ? "Свернуть" : "На весь экран"}
        </button>

      </div>
      {/* Строка состояния: таблица обязана говорить, что записала. Молчание
          после правки — это и есть сомнение «сохранилось ли». В покое пусто:
          место держим, текста не пишем. */}
      <p className="text-xs" role="status" style={{ color: "var(--text-secondary)", minHeight: "1.2em" }}>
        {beat ? beat.text : ""}
      </p>
    </div>
  );
}
