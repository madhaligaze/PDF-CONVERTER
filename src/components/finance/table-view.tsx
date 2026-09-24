"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UniverSheet, type UniverApi, type WorkbookSnapshot } from "@/components/univer/sheet";
import { useFillHeight } from "@/components/univer/use-fill-height";
import {
  type GridColumn,
  type GridPayload,
  type GridRow,
  FinanceApiError,
  financeApi,
} from "@/components/finance/api";

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

/**
 * Ячейка листа для значения колонки.
 *
 * Одна функция на сборку листа и на запись ответа сервера обратно: иначе
 * значение, пришедшее после правки, выглядело бы иначе, чем то же значение
 * при открытии листа, — дата текстом вместо даты, сумма без разрядов.
 */
function cellFor(column: GridColumn, raw: string): Record<string, unknown> {
  if (!raw) return { v: "" };
  if (column.kind === "money") {
    const asNumber = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(asNumber) ? { v: asNumber, s: "money" } : { v: String(raw) };
  }
  if (column.kind === "date") {
    const serial = serialOf(String(raw));
    return serial === null ? { v: String(raw) } : { v: serial, t: 2, s: "date" };
  }
  return column.editable ? { v: String(raw) } : { v: String(raw), s: "readonly" };
}

/** Значение ячейки в том виде, в каком его ждёт сервер. */
function rawOf(column: GridColumn, cell: unknown): unknown {
  if (cell === null || cell === undefined) return "";
  const value = typeof cell === "object" ? ((cell as { v?: unknown }).v ?? "") : cell;
  // Дата вернулась номером дня — переводим обратно, иначе на сервер
  // уехало бы «46174», и следующее чтение показало бы сорок шесть тысяч.
  if (column.kind === "date" && typeof value === "number") return dateOf(value);
  return value;
}

/**
 * То же ли это значение, что уже в учёте.
 *
 * Событие правки Univer присылает и на смену оформления (жирный, заливка), и
 * на нашу же запись ответа обратно в ячейку. Отправлять такое на сервер —
 * значит плодить версии и записи в истории без единой изменённой цифры.
 */
function same(column: GridColumn, raw: unknown, known: string): boolean {
  const a = String(raw ?? "").trim();
  const b = String(known ?? "").trim();
  if (column.kind === "money" && a && b) {
    const left = Number(a.replace(/\s/g, "").replace(",", "."));
    const right = Number(b);
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.005;
  }
  return a === b;
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
      if (raw) line[columnIndex] = cellFor(column, String(raw));
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
    } catch (exc) {
      // Список — удобство, а не условие работы листа. Но молчать нельзя:
      // именно так они однажды тихо исчезли на журнале в две тысячи строк, и
      // проверка увидела это раньше человека только потому, что смотрела в
      // консоль.
      console.warn(`список для колонки «${column.title}» не встал:`, exc);
    }
  }
}

/**
 * Лист, который сейчас на экране, и то, какая операция в какой его строке.
 *
 * Главное правило листа: **строка на экране — это адрес операции до тех пор,
 * пока лист не пересобран.** Карта строится один раз из того ответа, по
 * которому лист собран, и дальше меняется только по месту: правка обновляет
 * версию и ячейки своей строки, новая операция занимает ту пустую строку, где
 * её напечатали.
 *
 * Раньше после каждой правки журнал перечитывался целиком, а лист оставался
 * прежним. Перечитанный журнал отсортирован по дате заново, поэтому стоило
 * поправить дату — и операции ниже сдвигались в памяти на строку, а на экране
 * нет. Следующая правка уходила в соседнюю операцию. Проверено живьём 21
 * сентября: сумму правили у «Перевод · Тофиг Т.», а записалась она в «Билет
 * Avtobys», со строкой состояния «записано».
 */
type Mounted = {
  generation: number;
  payload: GridPayload;
  rows: Map<number, GridRow>;
};

function mount(payload: GridPayload, generation: number): Mounted {
  const rows = new Map<number, GridRow>();
  payload.rows.forEach((row, index) => rows.set(index + 1, row));
  return { generation, payload, rows };
}

/** Что сделано одной правкой — для строки состояния. */
type Tally = {
  saved: number;
  created: number;
  lastRow: number;
  refusals: string[];
  missing: string;
};

type Beat = { text: string; at: number; refusal: boolean };

/** Номер строки так, как его видит человек: слева у Univer строка шапки — «1». */
const shown = (sheetRow: number) => sheetRow + 1;

export function TableView({ onChanged, refresh = 0 }: { onChanged: () => void; refresh?: number }) {
  const [sheet, setSheet] = useState<Mounted | null>(null);
  const [error, setError] = useState("");
  const [beat, setBeat] = useState<Beat | null>(null);
  const { ref: box, height } = useFillHeight(360, 44);
  /**
   * Смонтированный лист держим и в ref: обработчик правки живёт внутри Univer
   * и пересоздаваться не должен — иначе подписка навесится повторно и одна
   * правка уедет на сервер дважды.
   */
  const current = useRef<Mounted | null>(null);
  const generation = useRef(0);
  /** Очередь правок: по одной, чтобы версия строки успевала обновиться. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Больше нуля — лист пишет в свои ячейки сам, и эти правки не наши. */
  const writing = useRef(0);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  // Чтение — с отменой: ответ, пришедший после ухода с раздела, не должен
  // собирать лист в уже снятом компоненте. `refresh` — кнопка «Перечитать» в
  // шапке раздела: только она пересобирает открытый лист.
  useEffect(() => {
    let alive = true;
    financeApi
      .grid({})
      .then((next) => {
        if (!alive) return;
        generation.current += 1;
        const mounted = mount(next, generation.current);
        current.current = mounted;
        setSheet(mounted);
        setError("");
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Лист не собрался"));
    return () => {
      alive = false;
    };
  }, [refresh]);

  /**
   * Сообщение гаснет само.
   *
   * «Строка 5: записано» через минуту — уже не отчёт о действии, а
   * утверждение о текущем состоянии, и неверное: рядом может идти правка,
   * которую сервер отклонил. Отказ держим дольше: его читают, а не замечают
   * краем глаза.
   */
  useEffect(() => {
    if (!beat) return;
    const id = window.setTimeout(() => setBeat(null), beat.refusal ? 12000 : 5000);
    return () => window.clearTimeout(id);
  }, [beat]);

  const onReady = useCallback((api: UniverApi) => {
    const disposers: Array<() => void> = [];
    // Карта этого листа. Не `current.current` в момент правки: если лист
    // пересоберут, старый обработчик обязан работать со своими строками, а не
    // с чужими.
    const mine = current.current;
    if (!mine) return;
    void applyDropdowns(api, mine.payload);
    const { columns } = mine.payload;

    const active = () => api.getActiveWorkbook()?.getActiveSheet();

    /** Записать в строку листа то, что знает сервер. */
    const writeRow = (sheetRow: number, row: GridRow | null) => {
      const target = active();
      if (!target) return;
      writing.current += 1;
      try {
        const values = [
          columns.map((column) => (row ? cellFor(column, row.cells[column.key] ?? "") : { v: "" })),
        ];
        target.getRange(sheetRow, 0, 1, columns.length).setValues(values);
      } catch (exc) {
        console.warn(`строка ${shown(sheetRow)} не перерисовалась:`, exc);
      } finally {
        writing.current -= 1;
      }
    };

    const writeHeader = () => {
      const target = active();
      if (!target) return;
      writing.current += 1;
      try {
        target
          .getRange(HEADER_ROW, 0, 1, columns.length)
          .setValues([columns.map((column) => ({ v: column.title, s: "head" }))]);
      } finally {
        writing.current -= 1;
      }
    };

    /** Строка целиком — для новой операции нужны все её ячейки, а не одна. */
    const readRow = (sheetRow: number): Record<string, unknown> => {
      const target = active();
      const cells: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        const cell = target?.getRange(sheetRow, index, 1, 1).getCellData?.();
        cells[column.key] = rawOf(column, cell);
      });
      return cells;
    };

    /** Строку успели поправить в другом окне: показать свежую и не гадать. */
    const refetch = async (sheetRow: number, id: string) => {
      try {
        const fresh = (await financeApi.grid({})).rows.find((row) => row.id === id) ?? null;
        if (fresh) mine.rows.set(sheetRow, fresh);
        writeRow(sheetRow, fresh);
      } catch {
        /* останется как есть; сервер всё равно не примет правку со старой версией */
      }
    };

    const saveExisting = async (sheetRow: number, index: number, tally: Tally) => {
      const column = columns[index];
      const row = mine.rows.get(sheetRow);
      if (!column || !row) return;
      const raw = rawOf(column, active()?.getRange(sheetRow, index, 1, 1).getCellData?.());
      if (same(column, raw, row.cells[column.key] ?? "")) return;
      if (!column.editable) {
        tally.refusals.push(`строка ${shown(sheetRow)}: «${column.title}» правится в карточке операции`);
        writeRow(sheetRow, row);
        return;
      }
      try {
        const out = await financeApi.patchCell({
          operation_id: row.id,
          column: column.key,
          value: raw,
          version: row.version,
        });
        mine.rows.set(sheetRow, out.row);
        // Обратно пишем ответ сервера, а не оставляем напечатанное: «3.9.26»
        // становится датой, «1 500,5» — суммой с разрядами, и на экране ровно
        // то, что в учёте.
        writeRow(sheetRow, out.row);
        tally.saved += 1;
        tally.lastRow = sheetRow;
      } catch (exc) {
        if (exc instanceof FinanceApiError && exc.status === 409) {
          await refetch(sheetRow, row.id);
          tally.refusals.push(
            `строка ${shown(sheetRow)}: её успели изменить — на экране свежие значения, повторите правку`,
          );
          return;
        }
        tally.refusals.push(
          `строка ${shown(sheetRow)}: ${exc instanceof Error ? exc.message : "правка не сохранилась"}`,
        );
        // Откат по месту. Оставить на экране значение, которое сервер не
        // принял, — значит показать цифру, которой нет в учёте.
        writeRow(sheetRow, row);
      }
    };

    const saveNew = async (sheetRow: number, tally: Tally) => {
      const cells = readRow(sheetRow);
      const filled = (key: string) => String(cells[key] ?? "").trim() !== "";
      if (!Object.keys(cells).some(filled)) return;
      // Пока строке не хватает данных, сервер не зовём: отказ после каждой
      // напечатанной ячейки читается как каприз, хотя человек просто ещё не
      // дописал. Говорим, чего не хватает, — ровным тоном, это не ошибка.
      const missing: string[] = [];
      if (!filled("paid_at")) missing.push("дата платежа");
      if (!filled("amount")) missing.push("сумма");
      if (!filled("account_from") && !filled("account_to"))
        missing.push("счёт: «Со счёта» — расход, «На счёт» — поступление");
      if (missing.length) {
        tally.missing = `строка ${shown(sheetRow)}: не хватает — ${missing.join(", ")}`;
        return;
      }
      try {
        const out = await financeApi.addGridRow(cells);
        // Операция остаётся там, где её напечатали. Место по дате она займёт
        // при следующей сборке листа — как новая строка в Excel не прыгает
        // посреди ввода в середину таблицы.
        mine.rows.set(sheetRow, out.row);
        writeRow(sheetRow, out.row);
        tally.created += 1;
        tally.lastRow = sheetRow;
      } catch (exc) {
        tally.refusals.push(
          `строка ${shown(sheetRow)}: ${exc instanceof Error ? exc.message : "операция не заведена"}`,
        );
      }
    };

    const apply = async (touched: Map<number, Set<number>>) => {
      const tally: Tally = { saved: 0, created: 0, lastRow: 0, refusals: [], missing: "" };
      const order = [...touched.keys()].sort((a, b) => a - b);
      const big = order.length > 20;
      for (const [position, sheetRow] of order.entries()) {
        if (big && position % 20 === 0) {
          setBeat({ text: `записываем строки: ${position} из ${order.length}`, at: Date.now(), refusal: false });
        }
        if (sheetRow === HEADER_ROW) {
          writeHeader();
          continue;
        }
        if (mine.rows.has(sheetRow)) {
          for (const index of [...(touched.get(sheetRow) ?? [])].sort((a, b) => a - b)) {
            await saveExisting(sheetRow, index, tally);
          }
        } else {
          await saveNew(sheetRow, tally);
        }
      }

      const done: string[] = [];
      if (tally.created === 1) done.push(`строка ${shown(tally.lastRow)}: операция заведена`);
      else if (tally.created > 1) done.push(`заведено операций: ${tally.created}`);
      if (tally.saved === 1 && !tally.created) done.push(`строка ${shown(tally.lastRow)}: записано`);
      else if (tally.saved > 1) done.push(`записано ячеек: ${tally.saved}`);

      if (tally.refusals.length) {
        const more = tally.refusals.length > 1 ? ` · ещё отказов: ${tally.refusals.length - 1}` : "";
        setBeat({
          text: [...done, tally.refusals[0] + more].join(" · "),
          at: Date.now(),
          refusal: true,
        });
      } else if (done.length) {
        setBeat({ text: done.join(" · "), at: Date.now(), refusal: false });
      } else if (tally.missing) {
        setBeat({ text: tally.missing, at: Date.now(), refusal: false });
      }
      if (tally.saved || tally.created) onChangedRef.current();
    };

    const values = api.addEvent?.(
      api.Event.SheetValueChanged,
      (event: {
        effectedRanges?: Array<{
          getRow: () => number;
          getColumn: () => number;
          getHeight?: () => number;
          getWidth?: () => number;
        }>;
      }) => {
        if (writing.current > 0) return;
        // Все ячейки всех затронутых диапазонов, а не левая верхняя. Вставка
        // столбца сумм из буфера приходит одним диапазоном; раньше из него
        // записывалась первая ячейка, а остальные оставались на экране и не
        // доходили до учёта.
        const touched = new Map<number, Set<number>>();
        for (const range of event.effectedRanges ?? []) {
          const top = range.getRow();
          const left = range.getColumn();
          const height = Math.max(1, range.getHeight?.() ?? 1);
          const width = Math.max(1, range.getWidth?.() ?? 1);
          for (let row = top; row < top + height; row += 1) {
            for (let column = left; column < Math.min(left + width, columns.length); column += 1) {
              if (!touched.has(row)) touched.set(row, new Set());
              touched.get(row)?.add(column);
            }
          }
        }
        if (!touched.size) return;
        queue.current = queue.current.then(() => apply(touched)).catch((exc) => {
          console.warn("правка листа не обработана:", exc);
        });
      },
    );
    if (values?.dispose) disposers.push(() => values.dispose());

    /**
     * Печать в ячейке со списком — это печать, а не выбор.
     *
     * Univer открывает выпадающий список, как только в такой ячейке открылся
     * редактор, и настройки, чтобы этого не делать, у него нет. Строка поиска
     * списка забирает фокус на второй-третьей букве: «Ба» оставалось в
     * ячейке, «нковский счёт» уходило в поиск, и Enter не записывал ничего.
     * Человек из Excel печатает название и жмёт Enter — поэтому правку,
     * начатую с клавиатуры, мы оставляем ячейке и список закрываем; сервер
     * узнаёт счёт и статью по началу названия. Мышью список открывается как
     * прежде — стрелкой в ячейке.
     */
    const KEYBOARD = 4; // DeviceInputEventType.Keyboard
    const edits = api.addEvent?.(
      api.Event.SheetEditStarted,
      (event: { column: number; eventType?: number }) => {
        if (event.eventType !== KEYBOARD || columns[event.column]?.kind !== "enum") return;
        const hide = () => {
          try {
            api.executeCommand?.("sheet.operation.hide-data-validation-dropdown", {});
          } catch {
            /* нет списка — нечего и закрывать */
          }
        };
        // Список открывается в той же подписке на редактор, что и событие, —
        // закрываем и сразу, и следующим тактом, после его отрисовки.
        hide();
        window.setTimeout(hide, 0);
        window.setTimeout(hide, 60);
      },
    );
    if (edits?.dispose) disposers.push(() => edits.dispose());
    return () => disposers.forEach((stop) => stop());
  }, []);

  const workbook = useMemo(() => (sheet ? buildWorkbook(sheet.payload) : null), [sheet]);

  // «На весь экран» и тема — в общем корне листов (`univer/sheet.tsx`).
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
      <div className="fin-sheet" ref={box} style={{ height }}>
        {workbook ? (
          <UniverSheet key={`journal|${sheet?.generation ?? 0}`} data={workbook} onReady={onReady} />
        ) : null}
      </div>
      {/* Строка состояния: таблица обязана говорить, что записала. Молчание
          после правки — это и есть сомнение «сохранилось ли». В покое пусто:
          место держим, текста не пишем. */}
      <div className="flex items-start gap-3">
        <p
          className="text-xs flex-1"
          role="status"
          style={{
            // Цвет — только отказу. «Записано» и «не хватает суммы» — ход работы.
            color: beat?.refusal ? "var(--accent-rose)" : "var(--text-secondary)",
            minHeight: "1.2em",
          }}
        >
          {beat ? beat.text : ""}
        </p>
        <a className="btn-ghost text-xs" href={financeApi.exportJournalUrl({})} download>
          Скачать в Excel
        </a>
      </div>
    </div>
  );
}
