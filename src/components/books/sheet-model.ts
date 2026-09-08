import type { Field, Row } from "@/components/books/api";
import type { WorkbookSnapshot } from "@/components/univer/sheet";

/**
 * Книга «Книг» → книга Univer, и обратный перевод координат.
 *
 * Модуль намеренно чистый: ни сети, ни Univer, ни React. Здесь живёт вся
 * арифметика «строка на экране ↔ строка в базе», а ошибиться в ней проще
 * всего — и цена ошибки такая, что сумма уезжает не в ту строку журнала.
 * Чистые функции проверяются тестами за миллисекунды и целиком.
 *
 * Разметка листа
 * ──────────────
 * Строка 0 — заголовки колонок. Дальше подряд строки книги в её собственном
 * порядке. Ниже последней — запас пустых строк: в таблице новую запись
 * заводят, спустившись вниз и напечатав, а не кнопкой, и упереться в конец
 * листа человек не должен.
 *
 * Колонка = поле книги по порядку `position`. Позиция колонки на экране —
 * не адрес поля: адрес это `key`, и вся запись обратно идёт по нему. То же
 * правило записано в правилах проекта про колонки листов BBC, и здесь оно по
 * той же причине — колонки вставляют и двигают.
 */

/** Сколько пустых строк держать под последней записью. */
export const SPARE_ROWS = 200;

/** Строка заголовков. Одна, всегда первая. */
export const HEADER_ROW = 0;

export type CellEdit = {
  /** Индекс строки книги (0 — первая запись), или `null` для новой. */
  index: number | null;
  field: Field;
  value: string;
};

/** Числовые типы показываем с выравниванием вправо, как деньги в таблице. */
const NUMERIC = new Set(["money", "number"]);

/** Стиль шапки: жирный, серый фон. Собирается один раз на книгу. */
const HEAD_STYLE = {
  bl: 1,
  bg: { rgb: "#f1f3f5" },
  vt: 2,
  bd: {
    b: { s: 1, cl: { rgb: "#c9ced6" } },
  },
};

/**
 * Префикс `[$-419]` — русская локаль ПРЯМО В ОБРАЗЦЕ формата.
 *
 * Движок форматов Univer берёт локаль не из книги, а из самого образца. Без
 * префикса тот же `#,##0.00` даёт «95,323.00» вместо «95 323,00»: цифры на
 * месте, а разделители чужие — худший вид расхождения, потому что число
 * выглядит правильным. То же правило и по той же причине применяет импорт из
 * Google (`app/webexcel/univer.py`).
 */
const RU = "[$-419]";

const MONEY_STYLE = { ht: 3, n: { pattern: `${RU}#,##0.00` } };
const NUMBER_STYLE = { ht: 3 };
const DATE_STYLE = { n: { pattern: `${RU}DD.MM.YYYY` } };

/**
 * Дата → порядковый номер дня, как их считает Excel: сутки от 30 декабря 1899.
 *
 * Отдавать дату строкой нельзя. Строка в таблице — текст: она не отсортируется
 * по времени, не встанет в формулу и покажется как «2026-06-01» вместо
 * «01.06.2026». Ровно это и было видно на первой же собранной книге.
 *
 * Обе точки берутся полночью по UTC, и разница между ними — целое число
 * суток. Часовой пояс сюда не входит вовсе, поэтому и защищаться от него не
 * нужно. Первая попытка всё же защищалась — брала полдень «на всякий случай»,
 * — и получала ровно половину суток сверху, которую `Math.round` округлял
 * вверх. Вся книга сдвинулась на день вперёд: `2026-06-01` показывалось как
 * `02.06.2026`. Заметить это можно было только сверив с исходной книгой, и
 * никакой ошибки при этом не возникало.
 */
const EPOCH = Date.UTC(1899, 11, 30);

export function serialOf(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(at)) return null;
  return Math.round((at - EPOCH) / 86400000);
}

/** Ширина колонки по типу — та же мера, что была в собственной решётке. */
function widthOf(field: Field): number {
  const byType: Record<string, number> = {
    money: 124,
    number: 104,
    date: 108,
    bool: 76,
    enum: 200,
    text: 220,
    formula: 140,
    unknown: 120,
  };
  const base = byType[field.type] ?? 160;
  return Math.max(base, Math.min(320, field.title.length * 8 + 28));
}

/**
 * Значение ячейки для Univer.
 *
 * Деньги и числа уходят числом, а не строкой: иначе они встанут слева, не
 * сложатся в сумму по выделению и не отсортируются по величине — то есть
 * перестанут быть числами ровно в той таблице, ради которой всё делается.
 * Неразобранное остаётся текстом: «уточнить» в денежной колонке встречается в
 * этих книгах регулярно, и подменять его нулём нельзя.
 */
export function cellOf(field: Field, raw: unknown): Record<string, unknown> {
  const text = raw === null || raw === undefined ? "" : String(raw);
  if (!text) return {};
  if (NUMERIC.has(field.type)) {
    const asNumber = Number(text.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(asNumber)) return { v: asNumber };
  }
  if (field.type === "date") {
    const serial = serialOf(text);
    if (serial !== null) return { v: serial, t: 2 };
  }
  return { v: text };
}

/** Обратно: то, что человек напечатал в ячейке, → значение поля книги. */
export function valueOf(cell: unknown, field?: Field): string {
  if (cell === null || cell === undefined) return "";
  const raw =
    typeof cell === "object"
      ? (cell as { v?: unknown }).v ?? ""
      : cell;
  if (raw === null || raw === undefined || raw === "") return "";

  // Дата вернулась номером дня — переводим обратно в тот вид, в котором книга
  // её хранит. Иначе в базу уехало бы «46174», и следующее чтение показало бы
  // сорок шесть тысяч вместо первого июня.
  if (field?.type === "date" && typeof raw === "number") return dateOf(raw);
  return String(raw);
}

/** Порядковый номер дня Excel → `ГГГГ-ММ-ДД`, как книга хранит даты. */
export function dateOf(serial: number): string {
  const at = new Date(EPOCH + Math.round(serial) * 86400000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

export function buildWorkbook(
  name: string,
  fields: Field[],
  rows: (Row | undefined)[],
  total: number,
): WorkbookSnapshot {
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};

  const head: Record<number, Record<string, unknown>> = {};
  fields.forEach((field, column) => {
    head[column] = { v: field.title, s: "head" };
  });
  cellData[HEADER_ROW] = head;

  for (let index = 0; index < total; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const line: Record<number, Record<string, unknown>> = {};
    fields.forEach((field, column) => {
      const cell = cellOf(field, row.values?.[field.key]);
      if (Object.keys(cell).length === 0) return;
      const style = styleOf(field);
      line[column] = style ? { ...cell, s: style } : cell;
    });
    if (Object.keys(line).length) cellData[index + 1] = line;
  }

  const columnData: Record<number, { w: number }> = {};
  fields.forEach((field, column) => {
    columnData[column] = { w: widthOf(field) };
  });

  return {
    id: `book-${name}`,
    name,
    locale: "ruRU",
    sheetOrder: ["book"],
    styles: {
      head: HEAD_STYLE,
      money: MONEY_STYLE,
      number: NUMBER_STYLE,
      date: DATE_STYLE,
    },
    sheets: {
      book: {
        id: "book",
        name,
        rowCount: total + SPARE_ROWS + 1,
        columnCount: Math.max(fields.length, 1),
        cellData,
        columnData,
        // Шапка примерзает: на середине книги из двадцати четырёх колонок без
        // неё не понять, в какой ты колонке.
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      },
    },
  };
}

function styleOf(field: Field): string | null {
  if (field.type === "money") return "money";
  if (field.type === "number") return "number";
  if (field.type === "date") return "date";
  return null;
}

/**
 * Правка ячейки листа → что менять в книге.
 *
 * `null` означает «трогать нечего»: заголовок правится отдельным путём, а
 * колонки за краем набора полей у нас просто нет.
 */
export function editAt(
  fields: Field[],
  total: number,
  sheetRow: number,
  sheetColumn: number,
  cell: unknown,
): CellEdit | null {
  const field = fields[sheetColumn];
  if (!field) return null;
  if (sheetRow === HEADER_ROW) return null;

  const index = sheetRow - 1;
  return {
    index: index < total ? index : null,
    field,
    value: valueOf(cell, field),
  };
}

/** Номер строки листа, на которой стоит первая пустая строка под книгой. */
export const firstBlankRow = (total: number) => total + 1;
