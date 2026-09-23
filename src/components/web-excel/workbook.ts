/**
 * Сборка книги Univer: из импортированных листов и из листов других таблиц полки.
 *
 * Главное, что здесь по-настоящему важно: **реестры стилей независимы**. У каждой
 * книги и у каждого импортированного листа свои «1», «2», «3», означающие
 * разное. Склеить их «как есть» значит перекрасить один лист в цвета другого —
 * молча и целиком. Поэтому при переносе id стиля получает приставку листа.
 *
 * Второе — ресурсы. Правила проверки данных, условное форматирование,
 * комментарии, картинки, фильтр Univer хранит не в листе, а в ресурсах книги,
 * разложенными по id листа. Лист, перенесённый без них, приезжает без своих
 * выпадающих списков — выглядит целым, а работает иначе.
 */
import { blankWorkbook, type WorkbookSnapshot } from "@/components/univer/sheet";

import type { CellRange, ImportedSheet, SheetList } from "./xlsx/types";

/** Совпадает с `DATA_VALIDATION_PLUGIN_NAME` в @univerjs/data-validation (там не экспортируется). */
const DATA_VALIDATION_RESOURCE = "SHEET_DATA_VALIDATION_PLUGIN";

/** Списки, ожидающие постановки на лист через API, — по id листа. */
export type PendingLists = Record<string, SheetList[]>;

export type Assembled = { workbook: WorkbookSnapshot; lists: PendingLists; fonts: string[] };

export type SheetInfo = { name: string; rows: number; cols: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Пустая книга без листов — основа для книги из импорта. */
export function emptyBook(name: string): WorkbookSnapshot {
  const book = blankWorkbook(name);
  book.sheets = {};
  book.sheetOrder = [];
  book.resources = [];
  return book;
}

function uniqueName(book: WorkbookSnapshot, wanted: string): string {
  const taken = new Set(Object.values(book.sheets ?? {}).map((sheet) => (sheet as Json).name));
  const base = (wanted || "Лист").slice(0, 90);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
}

function uniqueId(book: WorkbookSnapshot, wanted: string): string {
  let id = wanted;
  while (book.sheets?.[id]) id = `${wanted}-${Math.random().toString(36).slice(2, 6)}`;
  return id;
}

/** Id стилей листа → новые, с приставкой листа. Касается и строк, и колонок, и умолчания. */
function remapStyles(sheet: Json, remap: (id: string) => string | undefined): void {
  const fix = (holder: Json | undefined) => {
    if (holder && typeof holder.s === "string") {
      const mapped = remap(holder.s);
      if (mapped) holder.s = mapped;
    }
  };
  for (const row of Object.values((sheet.cellData ?? {}) as Json)) {
    for (const cell of Object.values(row as Json)) fix(cell as Json);
  }
  for (const row of Object.values((sheet.rowData ?? {}) as Json)) fix(row as Json);
  for (const column of Object.values((sheet.columnData ?? {}) as Json)) fix(column as Json);
  if (typeof sheet.defaultStyle === "string") sheet.defaultStyle = remap(sheet.defaultStyle) ?? sheet.defaultStyle;
}

function resourceData(book: WorkbookSnapshot, name: string): Json {
  const entry = (book.resources ?? []).find((item: Json) => item.name === name);
  if (!entry?.data) return {};
  try {
    const data = JSON.parse(entry.data);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeResource(book: WorkbookSnapshot, name: string, data: Json): void {
  const resources: Json[] = (book.resources ?? []).filter((item: Json) => item.name !== name);
  resources.push({ name, data: JSON.stringify(data) });
  book.resources = resources;
}

function addCheckboxes(book: WorkbookSnapshot, sheetId: string, ranges: CellRange[]): void {
  if (!ranges.length) return;
  const rules = resourceData(book, DATA_VALIDATION_RESOURCE);
  rules[sheetId] = [...(rules[sheetId] ?? []), { uid: `cb-${sheetId}`, type: "checkbox", ranges }];
  writeResource(book, DATA_VALIDATION_RESOURCE, rules);
}

/** Листы импорта — в книгу (новую или уже открытую). Книга меняется на месте. */
export function appendImported(book: WorkbookSnapshot, sheets: ImportedSheet[]): Assembled {
  book.sheets = book.sheets ?? {};
  book.sheetOrder = book.sheetOrder ?? [];
  book.styles = book.styles ?? {};
  const lists: PendingLists = {};
  const fonts = new Set<string>();

  for (const item of sheets) {
    const sheet = clone(item.sheet);
    const id = uniqueId(book, String(sheet.id));
    sheet.id = id;
    sheet.name = uniqueName(book, String(sheet.name));

    for (const [localId, style] of Object.entries(item.styles)) book.styles[`${id}:${localId}`] = style;
    remapStyles(sheet, (localId) => (item.styles[localId] ? `${id}:${localId}` : undefined));

    book.sheets[id] = sheet;
    book.sheetOrder.push(id);
    addCheckboxes(book, id, item.checkboxes);
    if (item.lists.length) lists[id] = item.lists;
    item.fonts.forEach((font) => fonts.add(font));
  }
  return { workbook: book, lists, fonts: [...fonts] };
}

/** Новая книга целиком из импорта. */
export function bookFromImport(title: string, sheets: ImportedSheet[]): Assembled {
  return appendImported(emptyBook(title), sheets);
}

/**
 * Листы другой таблицы полки — копией в эту книгу. Книга меняется на месте.
 *
 * Ресурсы переносятся общим правилом: всё, что лежит в ресурсе под id листа,
 * переезжает под новый id. Так приезжают и списки, и условное форматирование,
 * и комментарии, и картинки — без знания о каждом плагине в отдельности.
 */
export function appendFromBook(book: WorkbookSnapshot, source: WorkbookSnapshot, sheetIds: string[]): WorkbookSnapshot {
  book.sheets = book.sheets ?? {};
  book.sheetOrder = book.sheetOrder ?? [];
  book.styles = book.styles ?? {};
  const sourceStyles: Json = source.styles ?? {};

  for (const oldId of sheetIds) {
    const original = source.sheets?.[oldId];
    if (!original) continue;
    const sheet = clone(original) as Json;
    const id = uniqueId(book, `${oldId}-c${Math.random().toString(36).slice(2, 6)}`);
    sheet.id = id;
    sheet.name = uniqueName(book, String(sheet.name));

    remapStyles(sheet, (styleId) => {
      if (!(styleId in sourceStyles)) return undefined;
      const mapped = `${id}:${styleId}`;
      book.styles[mapped] = sourceStyles[styleId];
      return mapped;
    });

    book.sheets[id] = sheet;
    book.sheetOrder.push(id);

    for (const resource of (source.resources ?? []) as Json[]) {
      let data: Json;
      try {
        data = JSON.parse(resource.data);
      } catch {
        continue;
      }
      if (!data || typeof data !== "object" || Array.isArray(data) || !(oldId in data)) continue;
      const target = resourceData(book, resource.name);
      target[id] = clone(data[oldId]);
      writeResource(book, resource.name, target);
    }
  }
  return book;
}

/** Оглавление книги для полки: названия листов и занятый размер. */
export function sheetsOf(book: WorkbookSnapshot | null | undefined): SheetInfo[] {
  if (!book?.sheets) return [];
  const order: string[] = book.sheetOrder ?? Object.keys(book.sheets);
  return order
    .map((id) => book.sheets[id] as Json | undefined)
    .filter((sheet): sheet is Json => Boolean(sheet))
    .map((sheet) => {
      let rows = 0;
      let cols = 0;
      for (const [r, row] of Object.entries((sheet.cellData ?? {}) as Json)) {
        const cells = Object.keys(row as Json);
        if (!cells.length) continue;
        rows = Math.max(rows, Number(r) + 1);
        for (const c of cells) cols = Math.max(cols, Number(c) + 1);
      }
      return { name: String(sheet.name ?? "Лист"), rows, cols };
    });
}

/** Шрифты сохранённой книги — из её же реестра стилей. */
export function fontsOf(book: WorkbookSnapshot | null | undefined): string[] {
  const found = new Set<string>();
  const collect = (style: Json | undefined) => {
    if (style && typeof style.ff === "string") found.add(style.ff);
  };
  for (const style of Object.values((book?.styles ?? {}) as Json)) collect(style as Json);
  for (const sheet of Object.values((book?.sheets ?? {}) as Json)) {
    if (sheet && typeof (sheet as Json).defaultStyle === "object") collect((sheet as Json).defaultStyle);
  }
  return [...found];
}
