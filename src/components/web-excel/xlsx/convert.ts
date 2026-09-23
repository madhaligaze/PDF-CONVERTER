/**
 * Книга .xlsx (как её прочитал ExcelJS) → листы Univer.
 *
 * Тот же перевод, что жил на сервере в `app/webexcel/univer.py` для ответа
 * Google API, только из файла и в браузере. Сервер книг больше не разбирает:
 * сырой грид Google с оформлением весил там сотни мегабайт на вкладку.
 *
 * Решения, без которых импорт выглядит верно, а читается неправильно, —
 * каждое уже стоило дефекта на книгах BBC:
 *
 * * **Стили дедуплицируются**, самое частое оформление уезжает в
 *   `defaultStyle` листа. В .xlsx оформление у каждой ячейки своё, и без реестра
 *   объём снимка растёт на два порядка.
 * * **Образцу формата приписывается `[$-419]`.** `#,##0.00` не содержит
 *   разделителей — только их места; без метки локали выходит «95,323.00» вместо
 *   «95 323,00». Парная половина — `../numfmt-locale.ts`.
 * * **У ячейки с рамкой перетекание текста заменяется обрезкой.** Пара «рамка +
 *   перетекание» — самое дорогое в отрисовке Univer (95-й процентиль кадра на
 *   «Журнале» 574 мс против 121).
 * * **Размер листа — ровно привезённое плюс запас**, а не объявленный размер
 *   исходника: пустая порода с рамками обходится отрисовкой каждый кадр.
 * * **Формула переносится, только если наш движок её посчитает.** Функции
 *   Google (в выгрузке они приходят как `__xludf.DUMMYFUNCTION`) и ссылки на
 *   листы, которые не взяли, заменяются посчитанным значением, текст формулы —
 *   в `custom.gsFormula`. `#REF!` там, где в Google стоит сумма, хуже
 *   отсутствия формулы.
 * * **Флажок — число 1/0**, а не ИСТИНА: Univer рисует галочку, только если
 *   значение совпало с «отмечено» правила, а это 1.
 */
import type { Workbook, Worksheet } from "exceljs";

import type { CellRange, ImportedSheet, SheetList, SheetSummary } from "./types";

// ── Перечисления Univer числами (@univerjs/core) ─────────────────────────────
const T_STRING = 1;
const T_NUMBER = 2;
const T_BOOLEAN = 3;
const WRAP_CLIP = 2;
const WRAP_WRAP = 3;

const H_ALIGN: Record<string, number> = {
  left: 1,
  fill: 1,
  center: 2,
  centerContinuous: 2,
  right: 3,
  justify: 4,
  distributed: 6,
};
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, justify: 2, distributed: 2, bottom: 3 };
const BORDER: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};

/** Потолок листа. Больше Univer в браузере держит, но листать это уже тяжело. */
export const MAX_ROWS = 20_000;
export const MAX_COLS = 200;
/** Пустые строки под последней заполненной — место дописать, не упираясь в край. */
const EMPTY_TAIL_ROWS = 50;
/** Список в тысячу пунктов — уже не выбор, а поиск; Univer рисует его целиком. */
const LIST_LIMIT = 500;
const LOCALE_TAG = "[$-419]";

const UNPORTABLE =
  /__xludf|\b(IMPORTRANGE|IMPORTDATA|IMPORTHTML|IMPORTXML|IMPORTFEED|ARRAYFORMULA|QUERY|GOOGLEFINANCE|GOOGLETRANSLATE|DETECTLANGUAGE|SPARKLINE|IMAGE|FILTER|SORTN|FLATTEN|LAMBDA|LET|BYROW|BYCOL|MAKEARRAY|REDUCE|SCAN|MAP|DUMMYFUNCTION)\s*\(/i;

/** Ссылка на лист внутри формулы: `'Лист 1'!A1` или `Лист1!A1`. */
const SHEET_REF = /(?:'((?:[^']|'')+)'|([\p{L}\p{N}_.]+))!/gu;

// ── Цвета ────────────────────────────────────────────────────────────────────

/** Тема Office по умолчанию. 0/1 и 2/3 в .xlsx переставлены: 0 — белый, 1 — чёрный. */
const THEME = [
  "FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31",
  "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72",
];

/** Старая палитра .xls, на которую до сих пор ссылаются `indexed`-цвета. */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

function applyTint(rgb: string, tint: number): string {
  return [0, 2, 4]
    .map((i) => parseInt(rgb.slice(i, i + 2), 16))
    .map((v) => Math.round(tint < 0 ? v * (1 + tint) : v + (255 - v) * tint))
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0"))
    .join("");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hex(color: any): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  let rgb: string | undefined;
  if (typeof color.argb === "string" && color.argb.length >= 6) rgb = color.argb.slice(-6);
  else if (typeof color.theme === "number") rgb = THEME[color.theme];
  else if (typeof color.indexed === "number") {
    rgb = color.indexed === 64 ? "000000" : color.indexed === 65 ? "FFFFFF" : INDEXED[color.indexed];
  }
  if (!rgb || !/^[0-9a-f]{6}$/i.test(rgb)) return undefined;
  if (typeof color.tint === "number" && color.tint) rgb = applyTint(rgb, color.tint);
  return `#${rgb.toUpperCase()}`;
}

// ── Оформление ───────────────────────────────────────────────────────────────

type Style = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleOf(source: any): Style {
  const style: Style = {};
  if (!source) return style;

  const font = source.font;
  if (font) {
    if (font.name) style.ff = String(font.name);
    if (font.size) style.fs = Number(font.size);
    if (font.bold) style.bl = 1;
    if (font.italic) style.it = 1;
    if (font.underline && font.underline !== "none") style.ul = { s: 1 };
    if (font.strike) style.st = { s: 1 };
    const color = hex(font.color);
    // Чёрный текст — умолчание. Записанный явно, он только множит стили.
    if (color && color !== "#000000") style.cl = { rgb: color };
  }

  const fill = source.fill;
  if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") {
    const color = hex(fill.fgColor) ?? hex(fill.bgColor);
    if (color) style.bg = { rgb: color };
  }

  const align = source.alignment;
  if (align) {
    const h = H_ALIGN[align.horizontal];
    if (h) style.ht = h;
    const v = V_ALIGN[align.vertical];
    if (v) style.vt = v;
    if (align.textRotation === "vertical") style.tr = { a: 0, v: 1 };
    else if (typeof align.textRotation === "number" && align.textRotation) {
      // В .xlsx 91–180 — это наклон вниз, записанный как 90 + градусы.
      const angle = align.textRotation > 90 ? 90 - align.textRotation : align.textRotation;
      style.tr = { a: angle };
    }
  }

  const border = source.border;
  const bd: Style = {};
  if (border) {
    for (const [side, key] of [["top", "t"], ["bottom", "b"], ["left", "l"], ["right", "r"]] as const) {
      const edge = border[side];
      const kind = edge?.style ? BORDER[edge.style] : undefined;
      if (kind) bd[key] = { s: kind, cl: { rgb: hex(edge.color) ?? "#000000" } };
    }
  }
  if (Object.keys(bd).length) style.bd = bd;

  // Перенос решается после рамок: см. шапку файла.
  if (align?.wrapText) style.tb = WRAP_WRAP;
  else if (style.bd) style.tb = WRAP_CLIP;

  const pattern = typeof source.numFmt === "string" ? source.numFmt : "";
  if (pattern && pattern !== "General" && pattern !== "@") {
    style.n = { pattern: pattern.startsWith("[$-") ? pattern : `${LOCALE_TAG}${pattern}` };
  }
  return style;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

// ── Значения ─────────────────────────────────────────────────────────────────

/** Дата JS (ExcelJS строит её в UTC из номера дня) → номер дня Excel. */
function serial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

type Plain = { v?: string | number; t?: number; isDate?: boolean };

function plainOf(value: unknown): Plain {
  if (value === null || value === undefined) return {};
  if (typeof value === "number") return Number.isFinite(value) ? { v: value, t: T_NUMBER } : {};
  if (typeof value === "string") return value === "" ? {} : { v: value, t: T_STRING };
  if (typeof value === "boolean") return { v: value ? 1 : 0, t: T_BOOLEAN };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? {} : { v: serial(value), t: T_NUMBER, isDate: true };
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("error" in o) return { v: String(o.error), t: T_STRING };
    if (Array.isArray(o.richText)) {
      const text = (o.richText as Array<{ text?: string }>).map((run) => run.text ?? "").join("");
      return text ? { v: text, t: T_STRING } : {};
    }
    if ("hyperlink" in o) return plainOf(o.text);
  }
  return {};
}

/**
 * Значение, которое Google вложил в саму формулу-заглушку:
 * `IFERROR(__xludf.DUMMYFUNCTION("IMPORTRANGE(…)"), "из Google")`.
 *
 * Обычно то же значение лежит и в кэше ячейки, но файл, пересохранённый чем-то
 * кроме Excel и Google, кэш теряет — и ячейка приезжала бы пустой.
 */
function googleFallback(formula: string): Plain | null {
  if (!/__xludf\.DUMMYFUNCTION/i.test(formula)) return null;
  const match = /,\s*("(?:[^"]|"")*"|-?\d+(?:\.\d+)?(?:E[+-]?\d+)?|TRUE|FALSE)\s*\)\s*$/i.exec(formula);
  if (!match) return null;
  const raw = match[1];
  if (raw.startsWith('"')) {
    const text = raw.slice(1, -1).replace(/""/g, '"');
    return text ? { v: text, t: T_STRING } : {};
  }
  if (/^(TRUE|FALSE)$/i.test(raw)) return { v: /^TRUE$/i.test(raw) ? 1 : 0, t: T_BOOLEAN };
  return { v: Number(raw), t: T_NUMBER };
}

function stripExcelPrefixes(formula: string): string {
  return formula.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\./g, "");
}

function referencedSheets(formula: string): string[] {
  const found: string[] = [];
  for (const match of formula.matchAll(SHEET_REF)) {
    found.push(match[1] !== undefined ? match[1].replace(/''/g, "'") : match[2]);
  }
  return found;
}

// ── Диапазоны ────────────────────────────────────────────────────────────────

/** Клетки → вертикальные отрезки по колонкам: 900 флажков колонки — одно правило. */
function toRanges(cells: Array<[number, number]>): CellRange[] {
  const byColumn = new Map<number, number[]>();
  for (const [row, column] of cells) {
    const rows = byColumn.get(column) ?? [];
    rows.push(row);
    byColumn.set(column, rows);
  }
  const ranges: CellRange[] = [];
  for (const [column, rows] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    rows.sort((a, b) => a - b);
    let start = rows[0];
    let previous = rows[0];
    for (const row of rows.slice(1)) {
      if (row === previous + 1) {
        previous = row;
        continue;
      }
      ranges.push({ startRow: start, endRow: previous, startColumn: column, endColumn: column });
      start = previous = row;
    }
    ranges.push({ startRow: start, endRow: previous, startColumn: column, endColumn: column });
  }
  return ranges;
}

/** «B12» → [11, 1]. */
function decodeAddress(address: string): [number, number] | null {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(address.trim());
  if (!match) return null;
  let column = 0;
  for (const letter of match[1].toUpperCase()) column = column * 26 + (letter.charCodeAt(0) - 64);
  return [Number(match[2]) - 1, column - 1];
}

function unquoteSheet(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1).replace(/''/g, "'")
    : trimmed;
}

/** Значения справочника списка: «'Справочник'!$A$2:$A$50», «$D$1:$D$5» или имя диапазона. */
function valuesOfRef(workbook: Workbook, home: Worksheet, ref: string): string[] {
  let target = ref.trim().replace(/^=/, "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defined = (workbook as any).definedNames?.getRanges?.(target)?.ranges as string[] | undefined;
  if (defined?.length) target = defined[0];

  const bang = target.lastIndexOf("!");
  const sheet = bang >= 0 ? workbook.getWorksheet(unquoteSheet(target.slice(0, bang))) : home;
  const area = bang >= 0 ? target.slice(bang + 1) : target;
  if (!sheet) return [];

  const [from, to = from] = area.split(":");
  const start = decodeAddress(from);
  // Открытый конец («$I$2:$I») — до последней строки листа.
  const end = decodeAddress(to) ?? (start ? [sheet.rowCount - 1, start[1]] : null);
  if (!start || !end) return [];

  const seen = new Set<string>();
  const values: string[] = [];
  const lastRow = Math.min(end[0], start[0] + 5000);
  for (let r = start[0]; r <= lastRow && values.length < LIST_LIMIT; r += 1) {
    for (let c = start[1]; c <= end[1] && values.length < LIST_LIMIT; c += 1) {
      const text = sheet.getCell(r + 1, c + 1).text?.trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        values.push(text);
      }
    }
  }
  return values;
}

/** Состав встроенного списка `"Да,Нет,Возможно"`. */
function inlineList(formula: string): string[] | null {
  const trimmed = formula.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
  const seen = new Set<string>();
  return trimmed
    .slice(1, -1)
    .replace(/""/g, '"')
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(item) && (seen.add(item), true));
}

// ── Оглавление ───────────────────────────────────────────────────────────────

export function summarize(workbook: Workbook): SheetSummary[] {
  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rows: sheet.actualRowCount,
    cols: sheet.actualColumnCount,
    hidden: sheet.state !== "visible",
  }));
}

// ── Лист целиком ─────────────────────────────────────────────────────────────

export function convertSheet(workbook: Workbook, sheet: Worksheet, index: number, taken: Set<string>): ImportedSheet {
  const sourceRows = sheet.rowCount;
  const sourceCols = sheet.columnCount;
  const rowLimit = Math.min(sourceRows, MAX_ROWS);
  const colLimit = Math.min(sourceCols, MAX_COLS);

  // ── Проверки данных: списки и флажки ─────────────────────────────────────
  // ExcelJS раскладывает правило на каждую его клетку, но объект у всех клеток
  // одного правила общий — по нему и собираем обратно.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = ((sheet as any).dataValidations?.model ?? {}) as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byRule = new Map<any, Array<[number, number]>>();
  for (const [address, rule] of Object.entries(model)) {
    const at = decodeAddress(address);
    if (!at || at[0] >= rowLimit || at[1] >= colLimit) continue;
    const cells = byRule.get(rule) ?? [];
    cells.push(at);
    byRule.set(rule, cells);
  }

  const checkboxCells = new Set<string>();
  const checkboxList: Array<[number, number]> = [];
  const lists: SheetList[] = [];
  for (const [rule, cells] of byRule) {
    if (rule?.type !== "list" || !rule.formulae?.length) continue;
    const formula = String(rule.formulae[0]);
    const values = inlineList(formula) ?? valuesOfRef(workbook, sheet, formula);
    const upper = values.map((value) => value.toUpperCase());
    const isCheckbox =
      values.length === 2 && upper.includes("TRUE") && upper.includes("FALSE");
    if (isCheckbox) {
      for (const [r, c] of cells) {
        checkboxCells.add(`${r}:${c}`);
        checkboxList.push([r, c]);
      }
      continue;
    }
    if (!values.length) continue;
    lists.push({
      values: values.slice(0, LIST_LIMIT),
      ranges: toRanges(cells),
      strict: Boolean(rule.showErrorMessage) && (rule.errorStyle ?? "stop") === "stop",
      prompt: rule.showInputMessage && rule.prompt ? String(rule.prompt) : undefined,
    });
  }

  // ── Проход 1: значения и стили ───────────────────────────────────────────
  const styleCounts = new Map<string, number>();
  const styleCache = new WeakMap<object, string>();
  const fonts = new Set<string>();
  type Parsed = { plain: Plain; styleKey: string; formula?: string; keep?: string };
  const parsed = new Map<number, Map<number, Parsed>>();
  let lastFilledRow = -1;
  let lastUsedCol = -1;
  let frozenFormulas = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const r = rowNumber - 1;
    if (r >= rowLimit) return;
    const cells = new Map<number, Parsed>();
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const c = colNumber - 1;
      if (c >= colLimit) return;
      // Подчинённые клетки объединения несут копию значения главной.
      if (cell.isMerged && cell.master !== cell) {
        const styleKey = keyOf(cell.style);
        styleCounts.set(styleKey, (styleCounts.get(styleKey) ?? 0) + 1);
        cells.set(c, { plain: {}, styleKey });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = cell.value as any;
      let plain: Plain;
      let formula: string | undefined;
      let keep: string | undefined;
      if (raw && typeof raw === "object" && ("formula" in raw || "sharedFormula" in raw)) {
        plain = plainOf(raw.result);
        const text = cell.formula ? stripExcelPrefixes(`=${cell.formula}`) : "";
        if (text) {
          const foreign = referencedSheets(text).some((name) => !taken.has(name));
          if (UNPORTABLE.test(text) || foreign || (raw.result && typeof raw.result === "object" && "error" in raw.result)) {
            keep = text;
            frozenFormulas += 1;
            if (plain.v === undefined) plain = googleFallback(text) ?? plain;
          } else {
            formula = text;
          }
        }
      } else {
        plain = plainOf(raw);
      }

      if (checkboxCells.has(`${r}:${c}`) && plain.t === T_BOOLEAN) {
        plain = { v: plain.v, t: T_NUMBER };
      }

      const styleKey = keyOf(cell.style, plain.isDate);
      styleCounts.set(styleKey, (styleCounts.get(styleKey) ?? 0) + 1);
      cells.set(c, { plain, styleKey, formula, keep });
      if (plain.v !== undefined || formula || keep) {
        lastFilledRow = Math.max(lastFilledRow, r);
        lastUsedCol = Math.max(lastUsedCol, c);
      }
    });
    if (cells.size) parsed.set(r, cells);
  });

  function keyOf(source: unknown, isDate = false): string {
    const cached = source && typeof source === "object" ? styleCache.get(source) : undefined;
    let key = cached;
    if (key === undefined) {
      const style = styleOf(source);
      if (typeof style.ff === "string") fonts.add(style.ff);
      key = canonical(style);
      if (source && typeof source === "object") styleCache.set(source, key);
    }
    // Дата без образца формата показалась бы числом 46271 — даём ей образец.
    if (isDate && !key.includes('"n":')) {
      const style = JSON.parse(key) as Style;
      style.n = { pattern: `${LOCALE_TAG}dd.mm.yyyy` };
      key = canonical(style);
    }
    return key;
  }

  // ── Умолчание листа — самое частое оформление ────────────────────────────
  let defaultKey = "{}";
  let best = -1;
  for (const [key, count] of styleCounts) {
    if (count > best) {
      best = count;
      defaultKey = key;
    }
  }
  const styles: Record<string, unknown> = {};
  const styleIds = new Map<string, string>([[defaultKey, ""]]);
  const styleId = (key: string): string => {
    const existing = styleIds.get(key);
    if (existing !== undefined) return existing;
    const id = String(Object.keys(styles).length + 1);
    styles[id] = JSON.parse(key);
    styleIds.set(key, id);
    return id;
  };

  // ── Проход 2: cellData ───────────────────────────────────────────────────
  // Строки ниже последней заполненной с запасом отбрасываются вместе с
  // оформлением: у пустой породы оно совпадает с умолчанием листа.
  const keepRows = Math.min(rowLimit, lastFilledRow + 1 + EMPTY_TAIL_ROWS);
  const cellData: Record<string, Record<string, unknown>> = {};
  for (const [r, cells] of parsed) {
    if (r >= keepRows) continue;
    const out: Record<string, unknown> = {};
    for (const [c, item] of cells) {
      const cell: Record<string, unknown> = {};
      if (item.plain.v !== undefined) {
        cell.v = item.plain.v;
        if (item.plain.t) cell.t = item.plain.t;
      }
      const id = styleId(item.styleKey);
      if (id) cell.s = id;
      if (item.formula) cell.f = item.formula;
      if (item.keep) cell.custom = { gsFormula: item.keep };
      if (Object.keys(cell).length) out[String(c)] = cell;
    }
    if (Object.keys(out).length) cellData[String(r)] = out;
  }

  // ── Геометрия ────────────────────────────────────────────────────────────
  const rowData: Record<string, Record<string, number>> = {};
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const r = rowNumber - 1;
    if (r >= keepRows) return;
    const entry: Record<string, number> = {};
    if (row.height) {
      entry.h = Math.round((row.height * 4) / 3);
      // `ia: 0` — высота задана, мерить по содержимому не надо (см. профиль прокрутки).
      entry.ia = 0;
    }
    if (row.hidden) entry.hd = 1;
    if (Object.keys(entry).length) rowData[String(r)] = entry;
  });

  const columnCount = Math.max(lastUsedCol + 1, 26);
  const columnData: Record<string, Record<string, number>> = {};
  for (let c = 0; c < Math.min(columnCount, colLimit); c += 1) {
    const column = sheet.getColumn(c + 1);
    const entry: Record<string, number> = {};
    // Ширина в .xlsx — в символах шрифта по умолчанию; ×7+5 — ровно пиксели Google.
    if (column.width) entry.w = Math.round(column.width * 7 + 5);
    if (column.hidden) entry.hd = 1;
    if (Object.keys(entry).length) columnData[String(c)] = entry;
  }

  // Объединения: ExcelJS держит их по главной клетке. Границы замкнутые — как у Univer.
  const mergeData: CellRange[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const range of Object.values(((sheet as any)._merges ?? {}) as Record<string, any>)) {
    const m = range?.model;
    if (!m) continue;
    const merged = { startRow: m.top - 1, endRow: m.bottom - 1, startColumn: m.left - 1, endColumn: m.right - 1 };
    if (merged.startRow < keepRows && merged.startColumn < colLimit) mergeData.push(merged);
  }

  const view = sheet.views?.[0] as { state?: string; xSplit?: number; ySplit?: number; showGridLines?: boolean } | undefined;
  const frozen = view?.state === "frozen";
  const xSplit = frozen ? Number(view?.xSplit ?? 0) : 0;
  const ySplit = frozen ? Number(view?.ySplit ?? 0) : 0;

  const id = `x${index}-${Math.random().toString(36).slice(2, 8)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const worksheet: Record<string, any> = {
    id,
    name: sheet.name,
    rowCount: Math.max(keepRows, 100),
    columnCount,
    cellData,
    rowData,
    columnData,
    mergeData,
    defaultStyle: defaultKey === "{}" ? undefined : JSON.parse(defaultKey),
    freeze: { xSplit, ySplit, startRow: ySplit, startColumn: xSplit },
    showGridlines: view?.showGridLines === false ? 0 : 1,
    hidden: 0,
  };
  const tabColor = hex(sheet.properties?.tabColor);
  if (tabColor) worksheet.tabColor = tabColor;

  return {
    sheet: worksheet,
    styles,
    lists,
    checkboxes: toRanges(checkboxList),
    fonts: [...fonts],
    stats: {
      rows: Math.max(lastFilledRow + 1, 0),
      cols: Math.max(lastUsedCol + 1, 0),
      sourceRows,
      sourceCols,
      truncated: sourceRows > MAX_ROWS || sourceCols > MAX_COLS,
      frozenFormulas,
    },
  };
}
