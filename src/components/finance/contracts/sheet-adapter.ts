/**
 * Лист реестра договоров ↔ хранилище: всё, что связывает Univer с `store.ts`
 * (фронт-план 4.7).
 *
 * Книга = отборы
 * ──────────────
 * Каждый отбор — лист Univer в порядке `position`, вкладки — родная нижняя
 * лента, как в Excel, откуда человек пришёл. У каждого блока своя шапка,
 * потому что роли сторон и порядок колонок задаёт блок: в «Заказчик ГК /
 * Заказчик ГК» колонка F — «Заказчик», G — «Исполнитель», наоборот против
 * «Сводной». Раскладка блока: строка названия → шапка → строки договоров →
 * карман (пустая строка для нового договора этого блока) → отступ.
 *
 * Адрес ячейки — поле, а не колонка
 * ─────────────────────────────────
 * Колонка F в двух блоках одного листа — разные поля. Правка ячейки
 * переводится в поле договора только через карту `(блок, колонка) → поле`
 * (`ViewLayout.blocks[i].columns`). Номер колонки как адрес поля не
 * используется нигде — правило проекта «колонки по названиям, не по номерам»
 * относится и к своему листу.
 *
 * Адрес строки — `custom` первой ячейки
 * ─────────────────────────────────────
 * `{ cid }` у договора, `{ block }` у названия блока, `{ header }` у шапки,
 * `{ pocket }` у кармана. Первая колонка — всегда служебная «№» (если в шапке
 * файла её нет, лист ставит её сам): она защищена от правки, и вставка из
 * буфера не может переписать адрес строки. Сортировка Univer переносит `custom`
 * только внутри сортируемого диапазона, поэтому после неё лист читает адреса
 * заново: вся ширина — порядок принят, часть ширины — строки разъехались бы, и
 * лист возвращает их на место.
 *
 * Лист пишет в себя только мутациями
 * ──────────────────────────────────
 * Команды Univer проверяют права листа, а лист закрыт от вставки строк,
 * удаления и оформления — собственные записи (чужая правка, вспышка, новая
 * строка) шли бы через те же запреты. Мутации прав не спрашивают и не
 * попадают в историю отмены: Ctrl+Z не должен откатывать правку коллеги.
 * Счётчик `writing` отличает свои записи от человеческих, чтобы они не ушли
 * обратно на сервер.
 */
import { IUndoRedoService } from "@univerjs/core";

import type {
  Contract,
  Party,
  PersonRef,
  RegistryField,
  RegistrySchema,
  RegistryView,
  ViewBlock,
} from "@/components/finance/api";
import { departmentText, listText } from "@/components/finance/contracts/schema";
import {
  create,
  edit,
  forgetDeparted,
  getRegistry,
  type RegistryState,
} from "@/components/finance/contracts/store";
import { parseDay, plural, shortName } from "@/components/finance/format";
import type { UniverApi, WorkbookSnapshot } from "@/components/univer/sheet";
import {
  DATE_PATTERN,
  MONEY_PATTERN,
  WHOLE_PATTERN,
  cssHex,
  dateOf,
  excelWidthPx,
  invertLikeUniver,
  isDarkTheme,
  serialOf,
  textOfCell,
} from "@/components/univer/sheet-model";

// ── Раскладка ────────────────────────────────────────────────────────────────

/** Служебная колонка «№». Полем договора не является: её ставит лист. */
export const ORDINAL_KEY = "row_number";
/** «Как было в файле» — снимок на день выгрузки, только чтение. */
const SNAPSHOT_KEYS = new Set(["paid_snapshot", "remaining_snapshot"]);

const ROW_H = 24;
const TITLE_H = 30;
/** Пустые строки под последним блоком: вниз листа не упираются. */
const TAIL_ROWS = 40;
const FLASH_MS = 1200;
/** Сколько правка считается «здешней» и не вспыхивает, когда вернётся от сервера. */
const LOCAL_MS = 15000;

export type ColumnKind =
  | "ordinal" | "text" | "money" | "date" | "party" | "list" | "people" | "department" | "choice" | "bool" | "url";

export type SheetColumn = {
  key: string;
  label: string;
  width: number;
  kind: ColumnKind;
  field: RegistryField | null;
  readOnly: boolean;
};

export type BlockLayout = {
  index: number;
  title: string;
  showTitle: boolean;
  columns: SheetColumn[];
  headerHeight: number;
};

export type ViewLayout = {
  key: string;
  title: string;
  main: boolean;
  blocks: BlockLayout[];
  width: number;
  /** Один блок — шапка закрепляется и сортировка открыта. */
  single: boolean;
  /** Колонки, которые только для чтения во всех блоках листа, — их защищает Univer. */
  readOnlyCols: number[];
};

const DEFAULT_WIDTH: Record<ColumnKind, number> = {
  ordinal: 44, text: 180, money: 120, date: 100, party: 200, list: 150,
  people: 150, department: 80, choice: 110, bool: 60, url: 200,
};

function kindOf(key: string, field: RegistryField | null): ColumnKind {
  if (key === ORDINAL_KEY) return "ordinal";
  switch (field?.type) {
    case "money":
    case "number":
      return "money";
    case "date":
      return "date";
    case "party":
      return "party";
    case "list":
    case "multi_list":
      return "list";
    case "person":
      return "people";
    case "department":
      return "department";
    case "choice":
      return "choice";
    case "bool":
      return "bool";
    case "url":
      return "url";
    default:
      return "text";
  }
}

/**
 * Высота шапки блока — по самой длинной подписи.
 *
 * Подписи шапки взяты из файла как есть: «Текущее состояние (действующий/
 * недействующий/ на исполении/ исполнен/ не состоялся)» в колонке шириной в
 * сто пикселей. В одну строку такая подпись обрезалась бы на «Текущее сост»,
 * и человек не узнал бы свою колонку.
 */
function headerHeight(columns: SheetColumn[]): number {
  let lines = 1;
  for (const column of columns) {
    const perLine = Math.max(4, Math.floor((column.width - 8) / 6.2));
    lines = Math.max(lines, Math.min(5, Math.ceil(column.label.length / perLine)));
  }
  return 10 + lines * 14;
}

const EMPTY_BLOCK: ViewBlock = {
  title: "",
  filter: { any: [] },
  roles: {},
  columns: [],
  defaults: {},
};

export function layoutOf(schema: RegistrySchema, view: RegistryView): ViewLayout {
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  // Отбор без своих колонок — поля схемы в их порядке (скрытых в листе нет).
  const defaults = [...schema.fields]
    .filter((field) => !field.hidden)
    .sort((a, b) => a.position - b.position)
    .map((field) => ({ key: field.key, label: field.title, width: null as number | null | undefined }));
  const source = view.blocks.length ? view.blocks : [EMPTY_BLOCK];
  const blocks = source.map((block, index): BlockLayout => {
    const columns: SheetColumn[] = [];
    for (const item of block.columns.length ? block.columns : defaults) {
      const field = fields.get(item.key) ?? null;
      // Поля нет в схеме — значит, человеку оно не открыто: колонки нет вовсе.
      if (item.key !== ORDINAL_KEY && (!field || field.hidden)) continue;
      if (item.key === ORDINAL_KEY && columns.length) continue;
      const kind = kindOf(item.key, field);
      const role = item.key === "executor" || item.key === "customer" ? block.roles?.[item.key] : undefined;
      columns.push({
        key: item.key,
        label: (item.label || role || field?.title || "№").trim(),
        width: excelWidthPx(item.width, DEFAULT_WIDTH[kind]),
        kind,
        field,
        readOnly: kind === "ordinal" || SNAPSHOT_KEYS.has(item.key) || !field?.editable || !schema.access.edit,
      });
    }
    // Адрес строки живёт в первой ячейке — она обязана быть служебной.
    if (columns[0]?.kind !== "ordinal") {
      columns.unshift({
        key: ORDINAL_KEY, label: "№", width: DEFAULT_WIDTH.ordinal, kind: "ordinal", field: null, readOnly: true,
      });
    }
    const title = (block.title ?? "").trim();
    const showTitle = source.length > 1
      ? Boolean(title)
      : Boolean(title) && title.toLowerCase() !== view.title.trim().toLowerCase();
    return { index, title, showTitle, columns, headerHeight: headerHeight(columns) };
  });
  const width = Math.max(1, ...blocks.map((block) => block.columns.length));
  const readOnlyCols: number[] = [];
  for (let column = 0; column < width; column += 1) {
    if (blocks.every((block) => block.columns[column]?.readOnly)) readOnlyCols.push(column);
  }
  return { key: view.key, title: view.title, main: view.main, blocks, width, single: blocks.length === 1, readOnlyCols };
}

export function layoutsOf(schema: RegistrySchema): ViewLayout[] {
  return [...schema.views].sort((a, b) => a.position - b.position).map((view) => layoutOf(schema, view));
}

/**
 * Отпечаток раскладки: лист пересобирается целиком, только если он поменялся.
 *
 * Новое значение списка или переименованный контрагент — не повод пересоздать
 * книгу (секунда и потерянная прокрутка): их лист перепишет по месту.
 */
export function structureKey(schema: RegistrySchema): string {
  return JSON.stringify(
    layoutsOf(schema).map((layout) => [
      layout.key,
      layout.title,
      layout.blocks.map((block) => [
        block.title,
        block.columns.map((column) => [column.key, column.label, column.width, column.readOnly]),
      ]),
    ]),
  );
}

// ── Значение ячейки ──────────────────────────────────────────────────────────

type Face = { v: string | number | null; fmt: "" | "money" | "whole" | "date" };
const EMPTY_FACE: Face = { v: null, fmt: "" };

type Ctx = {
  schema: RegistrySchema;
  parties: Readonly<Record<string, Party>>;
  people: Readonly<Record<string, PersonRef>>;
};

/** Сумма из строки сервера («999.00») или из напечатанного («1 500 000»); не число — `null`. */
function numberOf(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/[\s  ]/g, "").replace(/(тг|тенге|₸|kzt)\.?$/i, "");
  const normal = /^-?\d+,\d{1,2}$/.test(clean) ? clean.replace(",", ".") : clean;
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : null;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Значение поля → что стоит в ячейке.
 *
 * Одна функция на сборку листа, на чужую правку и на ответ сервера: иначе
 * значение, пришедшее после правки, выглядело бы иначе, чем то же значение при
 * открытии листа, — дата текстом вместо даты, сумма без разрядов.
 */
function faceOf(column: SheetColumn, value: unknown, contract: Contract | undefined, ctx: Ctx): Face {
  if (column.kind === "money") {
    if (isEmpty(value)) {
      // Сумма, которая в файле была условием («20% от поступлений»), стоит
      // текстом в той же колонке — как в файле.
      const terms = column.key === "amount" ? contract?.values.amount_terms : undefined;
      return typeof terms === "string" && terms ? { v: terms, fmt: "" } : EMPTY_FACE;
    }
    const amount = numberOf(value);
    if (amount !== null) return { v: amount, fmt: Number.isInteger(amount) ? "whole" : "money" };
    return { v: String(value), fmt: "" };
  }
  if (isEmpty(value)) return EMPTY_FACE;
  switch (column.kind) {
    case "date": {
      const text = String(value);
      const serial = serialOf(text) ?? (parseDay(text) ? serialOf(parseDay(text) as string) : null);
      return serial !== null ? { v: serial, fmt: "date" } : { v: text, fmt: "" };
    }
    case "party":
      return { v: typeof value === "string" ? ctx.parties[value]?.name ?? value : String(value), fmt: "" };
    case "list":
      if (Array.isArray(value)) {
        return { v: value.map((item) => listText(ctx.schema, column.key, item) || String(item)).join(", "), fmt: "" };
      }
      return { v: listText(ctx.schema, column.key, value) || String(value), fmt: "" };
    case "people": {
      const ids = Array.isArray(value) ? value : [value];
      return {
        v: ids
          .map((item) => {
            const person = ctx.people[String(item)];
            return person ? shortName(person.name) : String(item);
          })
          .join(", "),
        fmt: "",
      };
    }
    case "department":
      return { v: departmentText(ctx.schema, value) || String(value), fmt: "" };
    case "choice":
      return { v: column.field?.choices?.find((item) => item.value === value)?.label ?? String(value), fmt: "" };
    case "bool":
      return { v: value === true ? "Да" : value === false ? "Нет" : String(value), fmt: "" };
    default:
      return { v: String(value), fmt: "" };
  }
}

/** Сравнимый отпечаток значения ячейки: число — числом, текст — текстом. */
function canonOf(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return `n:${Math.round(value * 100) / 100}`;
  const text = String(value).trim();
  return text ? `t:${text}` : "";
}

function canonOfCell(cell: unknown): string {
  const data = cell as { v?: unknown } | null | undefined;
  if (data && typeof data.v === "number") return canonOf(data.v);
  return canonOf(textOfCell(cell));
}

function faceText(face: Face): string {
  if (face.v === null) return "пусто";
  if (face.fmt === "date" && typeof face.v === "number") {
    const [year, month, day] = dateOf(face.v).split("-");
    return `${day}.${month}.${year}`;
  }
  if (typeof face.v === "number") return face.v.toLocaleString("ru-RU");
  return face.v;
}

/**
 * Что человек напечатал → сырой текст для сервера.
 *
 * Сервер разбирает сырое теми же функциями, что и загрузку Excel («1 500,50»,
 * «ТОО Атриум плюс», «до 15.07.2026»), поэтому лист не угадывает за него.
 * Исключения два: дата, которую Univer уже превратил в номер дня (иначе на
 * сервер уехало бы «46174»), и выбор из вариантов, у которого подпись
 * («В месяц») не равна значению (`month`).
 */
function rawOf(column: SheetColumn, cell: unknown): string {
  const value = (cell as { v?: unknown } | null | undefined)?.v;
  let raw: string;
  if (typeof value === "number") raw = column.kind === "date" ? dateOf(value) : String(value);
  else if (typeof value === "boolean") raw = value ? "да" : "нет";
  else raw = textOfCell(cell).trim();
  if (column.kind === "choice" && raw) {
    const needle = raw.toLowerCase();
    const choice = column.field?.choices?.find(
      (item) => item.label.toLowerCase() === needle || item.value.toLowerCase() === needle,
    );
    if (choice) return choice.value;
  }
  return raw;
}

// ── Цвета и стили ────────────────────────────────────────────────────────────

export type Palette = { dark: boolean; flash: string; fail: string; failBg: string };

/**
 * Бумага листа — постоянные светлые цвета: в тёмной теме Univer сам
 * перекрашивает их своей матрицей. Токены раздела (вспышка, отказ) читаются из
 * CSS и в тёмной теме отдаются заранее перевёрнутыми — см. `invertLikeUniver`.
 */
const PAPER = {
  headBg: "#efede5",
  headText: "#5a5d55",
  titleBg: "#e5e2d7",
  line: "#cfcbbf",
  muted: "#a3a69e",
  soft: "#7d8078",
};

export function paletteNow(): Palette {
  const dark = isDarkTheme();
  const canvas = (hex: string) => (dark ? invertLikeUniver(hex) : hex);
  return {
    dark,
    flash: canvas(cssHex("--fin-flash-hex", dark ? "#232521" : "#eceade")),
    fail: canvas(cssHex("--fin-fail-hex", dark ? "#ff6f5e" : "#c2331f")),
    failBg: canvas(cssHex("--fin-fail-bg-hex", dark ? "#2a1a17" : "#f7e3dc")),
  };
}

type Style = Record<string, unknown>;
type Part = "title" | "header" | "body" | "empty";

/**
 * Стиль ячейки. Флаги: F — замечание или отказ (единственный цвет листа),
 * M — приглушено (ждёт ответа «опечатка или с даты», договор ушёл),
 * L — вспышка чужой правки, O — строка открытой карточки.
 */
function cellStyle(part: Part, column: SheetColumn | null, fmt: Face["fmt"], flags: string, pal: Palette): Style | null {
  if (part === "title") return { bg: { rgb: PAPER.titleBg }, bl: 1, vt: 2 };
  if (part === "header") {
    // Шапка — наша, а не из файла: жёлтые и голубые заливки Excel спорили бы с
    // единственным цветом листа — розовой ячейкой ошибки.
    return {
      bg: { rgb: PAPER.headBg },
      cl: { rgb: PAPER.headText },
      vt: 2,
      tb: 3,
      fs: 9,
      bd: { b: { s: 1, cl: { rgb: PAPER.line } } },
    };
  }
  const style: Style = {};
  if (column?.kind === "ordinal") {
    style.ht = 2;
    style.fs = 9;
    style.cl = { rgb: PAPER.soft };
  } else if (column?.readOnly) {
    style.cl = { rgb: PAPER.soft };
  }
  if (fmt === "money") Object.assign(style, { n: { pattern: MONEY_PATTERN }, ht: 3 });
  if (fmt === "whole") Object.assign(style, { n: { pattern: WHOLE_PATTERN }, ht: 3 });
  if (fmt === "date") style.n = { pattern: DATE_PATTERN };
  if (flags.includes("M")) style.cl = { rgb: PAPER.muted };
  if (flags.includes("F")) {
    style.cl = { rgb: pal.fail };
    style.bg = { rgb: pal.failBg };
  }
  if (flags.includes("L") || flags.includes("O")) style.bg = { rgb: pal.flash };
  return Object.keys(style).length ? style : null;
}

// ── Строки листа ─────────────────────────────────────────────────────────────

type SlotKind = "title" | "header" | "row" | "gone" | "pocket" | "gap";

/**
 * Строка листа. Объект, а не запись по индексу: при перестройке строка
 * остаётся тем же объектом, и «с какой строки лист изменился» считается
 * сравнением ссылок.
 */
type Slot = {
  kind: SlotKind;
  block: number;
  /** Договор строки (`row`, `gone`). */
  id?: string;
  /** Заведена здесь из кармана — не приглушается, пока человек не ушёл с листа. */
  here?: boolean;
  /** `gone`: «Ушёл в «Заказчик ГК / Купля-продажа»». */
  text?: string;
  /** Карман, из которого договор заводится прямо сейчас. */
  job?: { later: Record<string, string> } | null;
};

type RowState = { canon: string[]; marks: string[]; notes: Map<number, string> | null };

/** Новый договор из строки листа: значения по ключам полей и карман, если печатали в нём. */
type CreateJob = { pocket: Slot | null; values: Record<string, string> };

type SheetModel = {
  layout: ViewLayout;
  slots: Slot[];
  /** Что лежит в ячейках сейчас (по нашему знанию) — для сравнения. */
  rows: (RowState | undefined)[];
  /** Договор → строка живой записи. */
  rowOf: Map<string, number>;
  /** Договор → все его строки на листе (живая и ушедшая). */
  rowsById: Map<string, number[]>;
  ordinals: number[];
  rowCount: number;
  /** Отложенные перестройки: применяются, когда человек выйдет из редактора. */
  pending: Array<(slots: Slot[]) => Slot[]>;
  recheck: boolean;
};

function reindex(model: SheetModel): void {
  model.rowOf.clear();
  model.rowsById.clear();
  model.ordinals = new Array(model.slots.length).fill(0);
  const counters = new Map<number, number>();
  model.slots.forEach((slot, row) => {
    if ((slot.kind === "row" || slot.kind === "gone") && slot.id) {
      const next = (counters.get(slot.block) ?? 0) + 1;
      counters.set(slot.block, next);
      model.ordinals[row] = next;
      if (slot.kind === "row") model.rowOf.set(slot.id, row);
      const list = model.rowsById.get(slot.id) ?? [];
      list.push(row);
      model.rowsById.set(slot.id, list);
    }
  });
}

function anchorOf(slot: Slot): Record<string, unknown> | null {
  switch (slot.kind) {
    case "title":
      return { block: slot.block };
    case "header":
      return { header: slot.block };
    case "row":
      return { cid: slot.id, b: slot.block };
    case "gone":
      return { gone: slot.id, b: slot.block };
    case "pocket":
      return { pocket: slot.block };
    default:
      return null;
  }
}

function anchorKey(anchor: unknown): string {
  if (!anchor || typeof anchor !== "object") return "";
  const data = anchor as Record<string, unknown>;
  if (typeof data.cid === "string") return `c:${data.cid}`;
  if (typeof data.gone === "string") return `g:${data.gone}`;
  if (typeof data.pocket === "number") return `p:${data.pocket}`;
  if (typeof data.header === "number") return `h:${data.header}`;
  if (typeof data.block === "number") return `t:${data.block}`;
  return "";
}

function rowHeight(slot: Slot | undefined, layout: ViewLayout): number {
  if (slot?.kind === "title") return TITLE_H;
  if (slot?.kind === "header") return layout.blocks[slot.block]?.headerHeight ?? ROW_H;
  return ROW_H;
}

function mergeRange(row: number, width: number) {
  return { startRow: row, endRow: row, startColumn: 0, endColumn: Math.max(0, width - 1), rangeType: 0 };
}

type RenderCtx = {
  state: RegistryState;
  pal: Palette;
  openId: string | null;
  lastSeen: Map<string, Contract>;
  flashUntil: Map<string, number>;
  ahead: Map<string, string>;
  places: Map<string, string>;
};

type Rendered = {
  part: Part;
  block: number;
  faces: Face[];
  flags: string[];
  notes: Map<number, string> | null;
  anchor: Record<string, unknown> | null;
};

function placesOf(schema: RegistrySchema): Map<string, string> {
  const places = new Map<string, string>();
  for (const view of schema.views) {
    places.set(view.key, view.title);
    view.blocks.forEach((block, index) => {
      const title = (block.title ?? "").trim();
      places.set(`${view.key}#${index}`, view.blocks.length > 1 && title ? `${view.title} / ${title}` : view.title);
    });
  }
  return places;
}

/** Почему строка больше не в своём блоке — или пусто, если она на месте. */
function awayText(layout: ViewLayout, slot: Slot, contract: Contract | undefined, ctx: RenderCtx): string {
  if (slot.kind === "gone") return slot.text ?? "";
  if (!slot.id) return "";
  if (!contract || contract.deleted) {
    const text = ctx.state.departed.get(slot.id) || "убран";
    const who = contract?.updated_by?.short_name;
    return `${text[0].toUpperCase()}${text.slice(1)}${who ? ` · ${who}` : ""}`;
  }
  if (slot.here) return "";
  if (contract.views.some((place) => place.view === layout.key && place.block === slot.block)) return "";
  const same = contract.views.find((place) => place.view === layout.key);
  const other = same ?? contract.views.find((place) => place.view !== layout.key && !isMainView(ctx, place.view));
  if (other) return `Ушёл в «${ctx.places.get(`${other.view}#${other.block}`) ?? other.view}»`;
  return `Больше не подходит под «${layout.title}»`;
}

function isMainView(ctx: RenderCtx, key: string): boolean {
  return ctx.state.schema?.views.find((view) => view.key === key)?.main ?? false;
}

function flashKey(sheet: string, id: string, column: number): string {
  return `${sheet}|${id}|${column}`;
}

function render(model: SheetModel, row: number, ctx: RenderCtx): Rendered {
  const { layout } = model;
  const slot = model.slots[row];
  const width = layout.width;
  const faces: Face[] = new Array(width).fill(EMPTY_FACE);
  const flags: string[] = new Array(width).fill("");
  const out: Rendered = { part: "empty", block: slot?.block ?? 0, faces, flags, notes: null, anchor: null };
  if (!slot) return out;
  out.anchor = anchorOf(slot);
  const block = layout.blocks[slot.block] ?? layout.blocks[0];
  if (slot.kind === "title") {
    out.part = "title";
    faces[0] = { v: block.title, fmt: "" };
    return out;
  }
  if (slot.kind === "header") {
    out.part = "header";
    block.columns.forEach((column, index) => {
      faces[index] = { v: column.label, fmt: "" };
    });
    return out;
  }
  if (slot.kind !== "row" && slot.kind !== "gone") return out;

  out.part = "body";
  const state = ctx.state;
  const schema = state.schema;
  if (!schema || !slot.id) return out;
  const id = slot.id;
  const contract = state.byId.get(id) ?? ctx.lastSeen.get(id);
  const edits = state.edits.get(id);
  const away = awayText(layout, slot, contract, ctx);
  const notes = new Map<number, string>();
  const valueCtx: Ctx = { schema, parties: state.parties, people: state.people };

  // Замечание ложится на колонку своего поля; поля в блоке нет — на номер.
  const issueCols = new Map<number, string[]>();
  for (const issue of contract?.issues ?? []) {
    if (issue.acknowledged) continue;
    let column = block.columns.findIndex((item) => item.key === issue.field);
    if (column < 0) column = block.columns.findIndex((item) => item.key === "number");
    if (column < 0) column = Math.min(1, block.columns.length - 1);
    const list = issueCols.get(column) ?? [];
    list.push(issue.text);
    issueCols.set(column, list);
  }

  const now = Date.now();
  block.columns.forEach((column, index) => {
    let mark = "";
    const texts: string[] = [];
    if (column.kind === "ordinal") {
      faces[index] = { v: model.ordinals[row] || null, fmt: "" };
      if (ctx.openId === id) mark += "O";
      if (away) texts.push(away);
    } else {
      const pending = edits?.get(column.key);
      const value = pending && pending.state !== "conflict" ? pending.value : contract?.values[column.key];
      faces[index] = faceOf(column, value, contract, valueCtx);
      if (pending?.state === "failed") {
        mark += "F";
        texts.push(pending.error || "Правка не сохранилась");
      } else if (pending?.state === "conflict") {
        mark += "F";
        const theirs = faceText(faceOf(column, pending.theirs, contract, valueCtx));
        const mine = faceText(faceOf(column, pending.value, contract, valueCtx));
        texts.push(
          `Только что изменено${pending.by ? ` · ${pending.by}` : ""}: ${theirs}. Ваше: ${mine} — напечатайте снова, чтобы поставить своё`,
        );
      } else if (pending?.state === "asking") {
        mark += "M";
      }
      for (const text of issueCols.get(index) ?? []) {
        if (!mark.includes("F")) mark += "F";
        texts.push(text);
      }
      const later = ctx.ahead.get(`${id}|${column.key}`);
      if (later) texts.push(later);
    }
    if (away && !mark.includes("M")) mark += "M";
    if ((ctx.flashUntil.get(flashKey(layout.key, id, index)) ?? 0) > now) mark += "L";
    flags[index] = mark;
    if (texts.length) notes.set(index, texts.join("\n"));
  });
  out.notes = notes.size ? notes : null;
  return out;
}

type CellData = { v?: string | number; t?: number; s?: Style | string; custom?: Record<string, unknown> };

/**
 * Стили повторяются: на лист их десяток-другой вариантов. Ключ собирается
 * строкой из того, от чего стиль зависит, — без `JSON.stringify` на каждую из
 * сотни тысяч ячеек книги в пять тысяч договоров.
 */
const styleMemo = new Map<string, Style | null>();

function styleOf(part: Part, spec: SheetColumn | null, fmt: Face["fmt"], flags: string, pal: Palette): { key: string; style: Style | null } {
  const key = `${pal.flash}${pal.fail}${pal.failBg}|${part}|${spec?.kind ?? ""}|${spec?.readOnly ? 1 : 0}|${fmt}|${flags}`;
  let style = styleMemo.get(key);
  if (style === undefined) {
    style = cellStyle(part, spec, fmt, flags, pal);
    if (styleMemo.size > 2000) styleMemo.clear();
    styleMemo.set(key, style);
  }
  return { key, style };
}

function makeCell(
  model: SheetModel,
  rendered: Rendered,
  column: number,
  pal: Palette,
  styleRef?: (key: string, style: Style) => string,
): CellData | null {
  const block = model.layout.blocks[rendered.block] ?? model.layout.blocks[0];
  const spec = block.columns[column] ?? null;
  const face = rendered.faces[column];
  const cell: CellData = {};
  if (face.v !== null) {
    cell.v = face.v;
    cell.t = typeof face.v === "number" ? 2 : 1;
  }
  let picked: { key: string; style: Style | null } | null = null;
  if (rendered.part === "title" || rendered.part === "header") {
    picked = styleOf(rendered.part, spec, face.fmt, "", pal);
  } else if (rendered.part === "body") {
    picked = styleOf("body", spec, face.fmt, rendered.flags[column], pal);
  } else if (column === 0 && rendered.anchor) {
    picked = styleOf("body", spec, "", "", pal);
  }
  if (picked?.style) cell.s = styleRef ? styleRef(picked.key, picked.style) : { ...picked.style };
  if (column === 0 && rendered.anchor) cell.custom = rendered.anchor;
  return Object.keys(cell).length ? cell : null;
}

function stateOf(rendered: Rendered): RowState {
  return {
    canon: rendered.faces.map((face, column) =>
      column === 0 ? `${canonOf(face.v)}|${anchorKey(rendered.anchor)}` : canonOf(face.v),
    ),
    marks: [...rendered.flags],
    notes: rendered.notes,
  };
}

function noteOf(sheet: string, row: number, column: number, text: string) {
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 34)), 0);
  return {
    id: `creg-${sheet}-${row}-${column}-${Math.random().toString(36).slice(2, 8)}`,
    row,
    col: column,
    width: 240,
    height: Math.min(220, 28 + lines * 18),
    note: text,
    show: false,
  };
}

// ── Сборка книги ─────────────────────────────────────────────────────────────

export type Built = {
  unitId: string;
  snapshot: WorkbookSnapshot;
  models: Map<string, SheetModel>;
  ctx: RenderCtx;
  first: string;
};

/**
 * Книга целиком одним проходом: договоры раскладываются по корзинам
 * «отбор#блок» за один обход реестра, ячейки собираются в снимок, стили
 * складываются в словарь книги. Поштучных вызовов Univer нет — на пяти тысячах
 * договоров это разница между долей секунды и минутой.
 */
export function buildRegistry(state: RegistryState, pal: Palette): Built | null {
  const schema = state.schema;
  if (!schema) return null;
  const layouts = layoutsOf(schema);
  const ctx: RenderCtx = {
    state,
    pal,
    openId: null,
    lastSeen: new Map(),
    flashUntil: new Map(),
    ahead: new Map(),
    places: placesOf(schema),
  };
  const buckets = new Map<string, string[]>();
  for (const id of state.order) {
    const contract = state.byId.get(id);
    if (!contract || contract.deleted) continue;
    for (const place of contract.views) {
      const key = `${place.view}#${place.block}`;
      const list = buckets.get(key);
      if (list) list.push(id);
      else buckets.set(key, [id]);
    }
  }

  const styleIds = new Map<string, string>();
  const styles: Record<string, Style> = {};
  const styleRef = (key: string, style: Style): string => {
    let id = styleIds.get(key);
    if (!id) {
      id = `c${styleIds.size}`;
      styleIds.set(key, id);
      styles[id] = style;
    }
    return id;
  };

  const models = new Map<string, SheetModel>();
  const sheets: Record<string, unknown> = {};
  const notes: Record<string, Record<number, Record<number, unknown>>> = {};
  for (const layout of layouts) {
    const slots: Slot[] = [];
    layout.blocks.forEach((block) => {
      if (block.showTitle) slots.push({ kind: "title", block: block.index });
      slots.push({ kind: "header", block: block.index });
      for (const id of buckets.get(`${layout.key}#${block.index}`) ?? []) {
        slots.push({ kind: "row", block: block.index, id });
      }
      slots.push({ kind: "pocket", block: block.index });
      slots.push({ kind: "gap", block: block.index });
    });
    const model: SheetModel = {
      layout,
      slots,
      rows: [],
      rowOf: new Map(),
      rowsById: new Map(),
      ordinals: [],
      rowCount: slots.length + TAIL_ROWS,
      pending: [],
      recheck: false,
    };
    reindex(model);

    const cellData: Record<number, Record<number, CellData>> = {};
    const rowData: Record<number, { h: number }> = {};
    const mergeData: ReturnType<typeof mergeRange>[] = [];
    const sheetNotes: Record<number, Record<number, unknown>> = {};
    slots.forEach((slot, row) => {
      const rendered = render(model, row, ctx);
      const line: Record<number, CellData> = {};
      for (let column = 0; column < layout.width; column += 1) {
        const cell = makeCell(model, rendered, column, pal, styleRef);
        if (cell) line[column] = cell;
      }
      if (Object.keys(line).length) cellData[row] = line;
      const height = rowHeight(slot, layout);
      if (height !== ROW_H) rowData[row] = { h: height };
      if (slot.kind === "title") mergeData.push(mergeRange(row, layout.width));
      for (const [column, text] of rendered.notes ?? []) {
        (sheetNotes[row] ??= {})[column] = noteOf(layout.key, row, column, text);
      }
      model.rows[row] = stateOf(rendered);
    });
    if (Object.keys(sheetNotes).length) notes[layout.key] = sheetNotes;

    const columnData: Record<number, { w: number }> = {};
    for (let column = 0; column < layout.width; column += 1) {
      const owner = layout.blocks.find((block) => block.columns[column]);
      columnData[column] = { w: owner?.columns[column].width ?? DEFAULT_WIDTH.text };
    }
    // Лист из одного блока закрепляет свою шапку. У листа с несколькими
    // закрепить нечего: закреплённая первая шапка подписала бы чужие колонки
    // нижних блоков.
    const headerRow = slots.findIndex((slot) => slot.kind === "header");
    sheets[layout.key] = {
      id: layout.key,
      name: layout.title,
      rowCount: model.rowCount,
      columnCount: layout.width,
      defaultRowHeight: ROW_H,
      cellData,
      rowData,
      columnData,
      mergeData,
      ...(layout.single && headerRow >= 0
        ? { freeze: { xSplit: 0, ySplit: headerRow + 1, startRow: headerRow + 1, startColumn: 0 } }
        : {}),
    };
    models.set(layout.key, model);
  }

  const unitId = `creg-${Date.now().toString(36)}`;
  return {
    unitId,
    models,
    ctx,
    first: layouts[0]?.key ?? "",
    snapshot: {
      id: unitId,
      name: "Реестр договоров",
      locale: "ruRU",
      sheetOrder: layouts.map((layout) => layout.key),
      styles,
      sheets,
      resources: [{ name: "SHEET_NOTE_PLUGIN", data: JSON.stringify(notes) }],
    },
  };
}

// ── Связка с живым листом ────────────────────────────────────────────────────

export type AskGroup = {
  sheet: string;
  items: { id: string; key: string }[];
  anchor: { id: string; key: string };
};

export type BindingEvents = {
  /** Строка под листом: «Заводим 12 договоров · 5», отказ сервера. Пусто — убрать. */
  note: (text: string, fail?: boolean) => void;
  /** Правка стороны или суммы ждёт ответа «опечатка или с даты». */
  ask: (group: AskGroup) => void;
  openCard: (id: string, ctx: { view: string; block: number }) => void;
  /** Активный лист сменился — чтобы пересборка вернулась на него же. */
  sheet: (view: string) => void;
  /** Лист поменяли в обход нас (вставили строку) — собрать книгу заново. */
  rebuild: () => void;
};

const M = {
  setValues: "sheet.mutation.set-range-values",
  rowData: "sheet.mutation.set-row-data",
  rowCount: "sheet.mutation.set-worksheet-row-count",
  addMerge: "sheet.mutation.add-worksheet-merge",
  removeMerge: "sheet.mutation.remove-worksheet-merge",
  note: "sheet.mutation.update-note",
  unnote: "sheet.mutation.remove-note",
  reorder: "sheet.mutation.reorder-range",
  move: "sheet.mutation.move-range",
  structural: new Set([
    "sheet.mutation.insert-row",
    "sheet.mutation.remove-rows",
    "sheet.mutation.insert-col",
    "sheet.mutation.remove-col",
  ]),
};

type Matrix = Record<number, Record<number, unknown>>;

function cellsOf(matrix: unknown): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!matrix || typeof matrix !== "object") return out;
  for (const [row, columns] of Object.entries(matrix as Matrix)) {
    if (!columns || typeof columns !== "object") continue;
    for (const column of Object.keys(columns)) out.push([Number(row), Number(column)]);
  }
  return out;
}

function columnLetter(index: number): string {
  let out = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
  }
  return out;
}

/** Первая строка, с которой два расклада расходятся; `-1` — одинаковы. */
function firstDiff(a: Slot[], b: Slot[]): number {
  const limit = Math.min(a.length, b.length);
  for (let index = 0; index < limit; index += 1) if (a[index] !== b[index]) return index;
  return a.length === b.length ? -1 : limit;
}

export class RegistryBinding {
  private readonly models: Map<string, SheetModel>;
  private readonly ctx: RenderCtx;
  private readonly unitId: string;
  /** Больше нуля — лист пишет в себя сам, и эти правки не человеческие. */
  private writing = 0;
  private editing: { sheet: string; row: number; col: number } | null = null;
  private deferred = new Set<string>();
  private creating = new Map<string, number>();
  private local = new Map<string, number>();
  private queuedCells = new Map<string, Set<string>>();
  private queuedFlush = false;
  private unflash = 0;
  private followTimer = 0;
  private followed: string | null = null;
  private disposers: Array<() => void> = [];
  private alive = true;

  constructor(
    private readonly api: UniverApi,
    built: Built,
    private readonly events: BindingEvents,
    private readonly host: HTMLElement | null,
  ) {
    this.models = built.models;
    this.ctx = built.ctx;
    this.unitId = built.unitId;
  }

  // ── Жизненный цикл ──

  start(active: string | null, openId: string | null): () => void {
    const api = this.api;
    const workbook = api.getActiveWorkbook?.();
    try {
      api.toggleDarkMode?.(this.ctx.pal.dark);
    } catch {
      /* старая версия без тёмной темы — лист останется светлым */
    }
    if (active && this.models.has(active)) {
      const sheet = workbook?.getSheetBySheetId?.(active);
      if (sheet) workbook.setActiveSheet(sheet);
    }
    this.ctx.openId = openId;
    if (openId) this.repaintIds([openId]);
    void this.applyPermissions().then(() => this.hideShadow());

    const listen = (disposable: { dispose?: () => void } | undefined | null) => {
      if (disposable?.dispose) this.disposers.push(() => disposable.dispose?.());
    };
    listen(api.onCommandExecuted?.((command: { id: string; params?: unknown }) => this.onCommand(command)));
    listen(
      api.addEvent?.(api.Event.SheetEditStarted, (event: { worksheet?: UniverApi; row: number; column: number }) => {
        this.editing = { sheet: event.worksheet?.getSheetId?.() ?? "", row: event.row, col: event.column };
      }),
    );
    listen(
      api.addEvent?.(api.Event.SheetEditEnded, () => {
        // Значение из редактора ложится командой чуть позже события — даём
        // ему лечь, потом дописываем то, что ждало выхода из редактора.
        window.setTimeout(() => {
          this.editing = null;
          this.afterEdit();
        }, 30);
      }),
    );
    listen(
      api.addEvent?.(api.Event.ActiveSheetChanged, (event: { activeSheet?: UniverApi }) => {
        const sheet = event.activeSheet?.getSheetId?.();
        if (sheet) this.onSheetEntered(sheet);
      }),
    );
    listen(
      api.addEvent?.(api.Event.SelectionChanged, (event: { worksheet?: UniverApi; selections?: { startRow: number }[] }) =>
        this.onSelection(event.worksheet?.getSheetId?.() ?? "", event.selections?.[0]?.startRow),
      ),
    );
    listen(
      api.addEvent?.(api.Event.CellClicked, (event: { worksheet?: UniverApi; row: number; column: number }) => {
        // Номер строки — ручка карточки: колонка защищена, щелчок по ней
        // ничего другого не делает.
        if (event.column !== 0) return;
        const sheet = event.worksheet?.getSheetId?.() ?? "";
        const slot = this.models.get(sheet)?.slots[event.row];
        if (slot?.kind === "row" && slot.id) {
          this.followed = slot.id;
          this.events.openCard(slot.id, { view: sheet, block: slot.block });
        }
      }),
    );
    // Тема приложения сменилась — лист следует за ней.
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => this.retheme());
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      this.disposers.push(() => observer.disconnect());
    }

    return () => {
      this.alive = false;
      window.clearTimeout(this.unflash);
      window.clearTimeout(this.followTimer);
      this.disposers.forEach((stop) => stop());
      this.disposers = [];
      // Тёмная тема Univer вешает класс на `<html>` и сама его не снимает —
      // остался бы, и светлый лист журнала получил бы тёмную ленту.
      document.documentElement.classList.remove("univer-dark");
    };
  }

  /**
   * Права листа — механизмом Univer, а не прятками: спрятанная кнопка не
   * мешает ни горячей клавише, ни вставке из буфера.
   *
   * * вставка и удаление колонок закрыты всем: состав колонок задаёт схема
   *   («Настроить реестр»), и лишняя колонка сдвинула бы адреса полей;
   * * строки не вставляются и не удаляются никем: договор заводят в кармане
   *   блока, убирают из карточки — у строки листа нет своей жизни отдельно от
   *   договора;
   * * оформление ячеек не закрыто, хотя оно нигде не хранится: Univer требует
   *   права на оформление для любой вставки из буфера, даже «только значения»
   *   (`_permissionCheckByPaste` в sheets-ui). Вместо запрета лист сам
   *   переписывает строку после правки — заливки, принесённые из Excel, не
   *   остаются;
   * * сортировка и фильтр — только на листе из одного блока: на листе с
   *   несколькими блоками сортировка перемешала бы шапки и строки чужих блоков;
   * * колонки «только чтение» (номер строки, «как было в файле», поля, которые
   *   человек видит, но не правит) защищены диапазоном.
   */
  private async applyPermissions(): Promise<void> {
    const api = this.api;
    const point = api.Enum?.WorksheetPermissionPoint;
    const rangePoint = api.Enum?.RangePermissionPoint;
    const workbook = api.getActiveWorkbook?.();
    if (!point || !workbook) return;
    // Штриховку снимаем до защиты, иначе лист успевает показаться под ней.
    await this.waitRendered();
    this.hideShadow();
    const canEdit = Boolean(this.ctx.state.schema?.access.edit);
    for (const model of this.models.values()) {
      if (!this.alive) return;
      const sheet = workbook.getSheetBySheetId?.(model.layout.key);
      const permission = sheet?.getWorksheetPermission?.();
      if (!permission) continue;
      try {
        // С версии 0.25 точки прав ставятся только на защищённый лист:
        // без `protect()` каждая бросает «worksheet protection does not exist»,
        // и лист оставался открытым для вставки строк и колонок.
        if (!permission.isProtected?.()) {
          await permission.protect({ name: "Реестр договоров", allowViewByOthers: true });
        }
        if (!canEdit) {
          await permission.setReadOnly();
          continue;
        }
        await permission.applyConfig({
          mode: "editable",
          points: {
            [point.InsertRow]: false,
            [point.DeleteRow]: false,
            [point.InsertColumn]: false,
            [point.DeleteColumn]: false,
            [point.Sort]: model.layout.single,
            [point.Filter]: model.layout.single,
          },
        });
        if (model.layout.readOnlyCols.length) {
          const ranges = model.layout.readOnlyCols.map((column) => {
            const letter = columnLetter(column);
            return sheet.getRange(`${letter}:${letter}`);
          });
          const rules = await permission.protectRanges([
            { ranges, options: { name: "Только чтение", allowViewByOthers: true } },
          ]);
          // Владелец правила — сам вошедший, а владельцу Univer правку
          // разрешает. Запрещаем явно.
          for (const rule of rules ?? []) {
            if (rangePoint) await rule.setPoint?.(rangePoint.Edit, false);
          }
        }
      } catch (exc) {
        console.warn(`права листа «${model.layout.title}» не встали:`, exc);
      }
    }
  }

  /**
   * Защищённый лист Univer заштриховывает целиком — косой сеткой поверх шапки
   * и всех строк, хотя править в нём можно почти всё; колонки «только чтение»
   * и так видны приглушённым текстом. Стратегию штриховки Univer читает из
   * настройки, когда создаёт отрисовку, а меняет только у уже созданной —
   * поэтому ставим её после прав, когда лист точно отрисован, и ещё раз чуть
   * позже на случай, если отрисовка доехала позже прав.
   */
  /** Отрисовка листа создаётся позже книги — ждём её (до трёх секунд). */
  private async waitRendered(): Promise<void> {
    for (let attempt = 0; attempt < 60 && this.alive; attempt += 1) {
      try {
        if (this.api.getActiveWorkbook?.()?.getActiveSheet?.()?.getSkeleton?.()) return;
      } catch {
        /* отрисовки ещё нет */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  private hideShadow(): void {
    const apply = () => {
      if (!this.alive) return;
      try {
        this.api.setProtectedRangeShadowStrategy?.("none");
      } catch {
        /* старая версия без стратегии — штриховка останется */
      }
    };
    apply();
    const timer = window.setTimeout(apply, 600);
    this.disposers.push(() => window.clearTimeout(timer));
  }

  // ── Запись в лист ──

  private exec(id: string, params: Record<string, unknown>): void {
    this.writing += 1;
    try {
      this.api.syncExecuteCommand(id, params);
    } catch (exc) {
      console.warn(`лист не принял ${id}:`, exc);
    } finally {
      this.writing -= 1;
    }
  }

  private isEditingCell(sheet: string, row: number, column: number): boolean {
    const editing = this.editing;
    return Boolean(editing && editing.sheet === sheet && editing.row === row && editing.col === column);
  }

  private isLocal(id: string, key: string): boolean {
    const now = Date.now();
    return (this.local.get(`${id}|${key}`) ?? 0) > now || (this.local.get(`${id}|*`) ?? 0) > now;
  }

  /** Эту правку сделали здесь: когда она вернётся от сервера, ячейка не вспыхнет. */
  touch(items: { id: string; key: string }[]): void {
    const until = Date.now() + LOCAL_MS;
    for (const item of items) this.local.set(`${item.id}|${item.key}`, until);
  }

  /**
   * Переписать строки листа по хранилищу.
   *
   * * `diff` — только изменившиеся ячейки; изменённое не здесь вспыхивает;
   * * `force` — строка целиком (вернуть на место то, что человек не мог
   *   поменять, — шапку, защищённую колонку, строку после сортировки);
   * * `fresh` — строки только что очищены перестройкой.
   *
   * Ячейку, открытую редактором, лист не трогает: значение применится, когда
   * человек выйдет из редактора, если он не поменял его сам.
   */
  private paint(model: SheetModel, rows: Iterable<number>, mode: "diff" | "force" | "fresh"): void {
    const sheet = model.layout.key;
    const width = model.layout.width;
    const pal = this.ctx.pal;
    const clear: Matrix = {};
    const set: Matrix = {};
    const noteOps: Array<[string, Record<string, unknown>]> = [];
    const now = Date.now();
    let flashed = false;
    for (const row of rows) {
      if (row < 0 || row >= model.slots.length) continue;
      const rendered = render(model, row, this.ctx);
      const next = stateOf(rendered);
      const old = mode === "fresh" ? undefined : model.rows[row];
      const slot = model.slots[row];
      const block = model.layout.blocks[rendered.block] ?? model.layout.blocks[0];
      for (let column = 0; column < width; column += 1) {
        const valueChanged = !old || old.canon[column] !== next.canon[column];
        const markChanged = !old || old.marks[column] !== next.marks[column];
        if (mode === "diff" && !valueChanged && !markChanged) continue;
        if (this.isEditingCell(sheet, row, column)) {
          this.deferred.add(`${sheet}|${row}`);
          if (old) {
            next.canon[column] = old.canon[column];
            next.marks[column] = old.marks[column];
          }
          continue;
        }
        const spec = block.columns[column];
        if (
          mode === "diff" && valueChanged && old && slot.kind === "row" && slot.id &&
          spec && spec.kind !== "ordinal" && !this.isLocal(slot.id, spec.key)
        ) {
          this.ctx.flashUntil.set(flashKey(sheet, slot.id, column), now + FLASH_MS);
          if (!rendered.flags[column].includes("L")) rendered.flags[column] += "L";
          next.marks[column] = rendered.flags[column];
          flashed = true;
        }
        if (mode !== "fresh") (clear[row] ??= {})[column] = null;
        const cell = makeCell(model, rendered, column, pal);
        if (cell) (set[row] ??= {})[column] = cell;
      }
      const before = old?.notes ?? null;
      const after = next.notes;
      const columns = new Set<number>([...(before?.keys() ?? []), ...(after?.keys() ?? [])]);
      for (const column of columns) {
        const was = before?.get(column);
        const text = after?.get(column);
        if (was === text && mode !== "fresh") continue;
        if (was && mode !== "fresh") noteOps.push([M.unnote, { unitId: this.unitId, sheetId: sheet, row, col: column }]);
        if (text) {
          noteOps.push([M.note, { unitId: this.unitId, sheetId: sheet, row, col: column, note: noteOf(sheet, row, column, text) }]);
        }
      }
      model.rows[row] = next;
    }
    if (Object.keys(clear).length) this.exec(M.setValues, { unitId: this.unitId, subUnitId: sheet, cellValue: clear });
    if (Object.keys(set).length) this.exec(M.setValues, { unitId: this.unitId, subUnitId: sheet, cellValue: set });
    for (const [id, params] of noteOps) this.exec(id, params);
    if (flashed) this.scheduleUnflash();
  }

  private scheduleUnflash(): void {
    window.clearTimeout(this.unflash);
    this.unflash = window.setTimeout(() => {
      if (!this.alive) return;
      const now = Date.now();
      const bySheet = new Map<string, Set<string>>();
      let next = Infinity;
      for (const [key, until] of this.ctx.flashUntil) {
        if (until > now) {
          next = Math.min(next, until);
          continue;
        }
        this.ctx.flashUntil.delete(key);
        const [sheet, id] = key.split("|");
        const set = bySheet.get(sheet) ?? new Set<string>();
        set.add(id);
        bySheet.set(sheet, set);
      }
      for (const [sheet, ids] of bySheet) {
        const model = this.models.get(sheet);
        if (!model) continue;
        const rows = [...ids].flatMap((id) => model.rowsById.get(id) ?? []);
        this.paint(model, rows, "diff");
      }
      if (next !== Infinity) this.scheduleUnflash();
    }, FLASH_MS + 40);
  }

  /** Все строки договоров во всех листах — по хранилищу. */
  private repaintIds(ids: Iterable<string>): void {
    const list = [...ids];
    for (const model of this.models.values()) {
      const rows = list.flatMap((id) => model.rowsById.get(id) ?? []);
      if (rows.length) this.paint(model, rows, "diff");
    }
  }

  private clearUndo(): void {
    // Строки сдвинулись — записи отмены указывают на старые адреса, и Ctrl+Z
    // вернул бы значение не в ту строку, то есть в чужой договор.
    try {
      const injector = (this.api as { _injector?: { get: (token: unknown) => unknown } })._injector;
      const service = injector?.get(IUndoRedoService) as { clearUndoRedo?: (unitId: string) => void } | undefined;
      service?.clearUndoRedo?.(this.unitId);
    } catch {
      /* без очистки: следующая правка всё равно сверяется с хранилищем */
    }
  }

  // ── Перестройка строк ──

  private transform(model: SheetModel, change: (slots: Slot[]) => Slot[]): void {
    model.pending.push(change);
    this.flushStructure(model);
  }

  private flushStructure(model: SheetModel): void {
    if (!model.pending.length) return;
    let next = model.slots;
    for (const change of model.pending) next = change(next);
    const from = firstDiff(model.slots, next);
    if (from < 0) {
      model.pending = [];
      return;
    }
    // Редактор открыт ниже места перестройки: его значение легло бы в
    // сдвинутую строку, то есть в чужой договор. Ждём выхода из редактора.
    const editing = this.editing;
    if (editing && editing.sheet === model.layout.key && editing.row >= from) return;
    model.pending = [];
    this.relayout(model, next, from);
  }

  /**
   * Переложить строки листа с `from` и до конца: очистить, переписать,
   * перенести объединения, высоты и заметки. Выше `from` лист не трогается.
   */
  private relayout(model: SheetModel, next: Slot[], from: number): void {
    const sheet = model.layout.key;
    const width = model.layout.width;
    const old = model.slots;
    const end = Math.max(old.length, next.length);
    const unit = { unitId: this.unitId, subUnitId: sheet };

    const need = next.length + TAIL_ROWS;
    if (need > model.rowCount) {
      this.exec(M.rowCount, { ...unit, rowCount: need });
      model.rowCount = need;
    }
    const dropMerges = [];
    for (let row = from; row < old.length; row += 1) if (old[row].kind === "title") dropMerges.push(mergeRange(row, width));
    if (dropMerges.length) this.exec(M.removeMerge, { ...unit, ranges: dropMerges });
    for (let row = from; row < end; row += 1) {
      for (const column of model.rows[row]?.notes?.keys() ?? []) {
        this.exec(M.unnote, { unitId: this.unitId, sheetId: sheet, row, col: column });
      }
    }
    const clear: Matrix = {};
    const heights: Record<number, { h: number }> = {};
    for (let row = from; row < end; row += 1) {
      const line: Record<number, null> = {};
      for (let column = 0; column < width; column += 1) line[column] = null;
      clear[row] = line;
      heights[row] = { h: rowHeight(next[row], model.layout) };
    }
    this.exec(M.setValues, { ...unit, cellValue: clear });
    this.exec(M.rowData, { ...unit, rowData: heights });

    model.slots = next;
    model.rows.length = Math.min(model.rows.length, from);
    reindex(model);
    const rows: number[] = [];
    for (let row = from; row < next.length; row += 1) rows.push(row);
    this.paint(model, rows, "fresh");
    const addMerges = [];
    for (let row = from; row < next.length; row += 1) if (next[row].kind === "title") addMerges.push(mergeRange(row, width));
    if (addMerges.length) this.exec(M.addMerge, { ...unit, ranges: addMerges });
    this.clearUndo();
  }

  // ── Хранилище → лист ──

  /**
   * Новое состояние хранилища. Переписываются только договоры, у которых
   * поменялась запись или правка; справочники (контрагенты, люди, схема) —
   * повод пересверить весь лист, но записывается всё равно только разница.
   */
  sync(next: RegistryState): void {
    const prev = this.ctx.state;
    if (next === prev) return;
    this.ctx.state = next;
    for (const [id, contract] of prev.byId) if (!next.byId.has(id)) this.ctx.lastSeen.set(id, contract);
    // Словари хранилище пересобирает на каждом ответе; пересверять весь лист
    // стоит, только если чьё-то имя правда поменялось.
    const renamed = (a: Readonly<Record<string, { name: string }>>, b: Readonly<Record<string, { name: string }>>) =>
      a !== b && Object.keys(b).some((key) => a[key] !== undefined && a[key].name !== b[key].name);
    const full = next.schema !== prev.schema || renamed(prev.parties, next.parties) || renamed(prev.people, next.people);
    if (next.schema !== prev.schema && next.schema) this.ctx.places = placesOf(next.schema);
    let changed: Set<string> | null = null;
    if (!full) {
      changed = new Set<string>();
      for (const [id, contract] of next.byId) if (prev.byId.get(id) !== contract) changed.add(id);
      for (const id of prev.byId.keys()) if (!next.byId.has(id)) changed.add(id);
      for (const [id, edits] of next.edits) if (prev.edits.get(id) !== edits) changed.add(id);
      for (const id of prev.edits.keys()) if (!next.edits.has(id)) changed.add(id);
      if (next.departed !== prev.departed) {
        for (const id of next.departed.keys()) changed.add(id);
        for (const id of prev.departed.keys()) changed.add(id);
      }
      if (!changed.size) return;
    }
    for (const model of this.models.values()) {
      this.structure(model, changed);
      if (changed) {
        const rows = [...changed].flatMap((id) => model.rowsById.get(id) ?? []);
        if (rows.length) this.paint(model, rows, "diff");
      } else {
        this.paint(model, model.slots.keys(), "diff");
      }
    }
  }

  /**
   * Состав листа: договор пришёл в блок (заведён коллегой, сменил вид) —
   * встаёт над карманом блока; ушёл в другой блок того же листа — прежняя
   * строка приглушается с заметкой, а в новом блоке появляется своя.
   */
  private structure(model: SheetModel, changed: Set<string> | null): void {
    const state = this.ctx.state;
    const view = model.layout.key;
    const additions = new Map<number, Contract[]>();
    const moved: number[] = [];
    const ids = changed ?? state.byId.keys();
    for (const id of ids) {
      const contract = state.byId.get(id);
      const places = contract && !contract.deleted
        ? contract.views.filter((place) => place.view === view && place.block < model.layout.blocks.length)
        : [];
      const row = model.rowOf.get(id);
      if (row === undefined) {
        if (contract && places.length) {
          const list = additions.get(places[0].block) ?? [];
          list.push(contract);
          additions.set(places[0].block, list);
        }
        continue;
      }
      const slot = model.slots[row];
      if (contract && places.length && !places.some((place) => place.block === slot.block)) {
        slot.kind = "gone";
        slot.text = `Ушёл в «${this.ctx.places.get(`${view}#${places[0].block}`) ?? view}»`;
        moved.push(row);
        const list = additions.get(places[0].block) ?? [];
        list.push(contract);
        additions.set(places[0].block, list);
      }
    }
    if (moved.length) {
      reindex(model);
      this.paint(model, moved, "diff");
    }
    if (!additions.size) return;
    // Пока из кармана этого листа заводится договор, новый договор может
    // оказаться им же — разберёмся, когда заведение закончится.
    if (this.creating.get(view)) {
      model.recheck = true;
      return;
    }
    for (const list of additions.values()) list.sort((a, b) => a.position - b.position);
    this.transform(model, (slots) => {
      const present = new Set(slots.filter((slot) => slot.kind === "row").map((slot) => slot.id));
      const out = slots.slice();
      for (const [block, contracts] of additions) {
        const fresh = contracts.filter((contract) => !present.has(contract.id));
        if (!fresh.length) continue;
        const at = out.findIndex((slot) => slot.kind === "pocket" && slot.block === block);
        if (at < 0) continue;
        out.splice(at, 0, ...fresh.map((contract): Slot => ({ kind: "row", block, id: contract.id })));
      }
      return out;
    });
  }

  private afterEdit(): void {
    if (!this.alive) return;
    const deferred = [...this.deferred];
    this.deferred.clear();
    for (const key of deferred) {
      const [sheet, row] = key.split("|");
      const model = this.models.get(sheet);
      if (model) this.paint(model, [Number(row)], "diff");
    }
    for (const model of this.models.values()) this.flushStructure(model);
  }

  // ── Лист → хранилище ──

  private onCommand(command: { id: string; params?: unknown }): void {
    if (this.writing > 0 || !this.alive) return;
    const params = command.params as
      | {
          unitId?: string;
          subUnitId?: string;
          cellValue?: unknown;
          range?: { startRow: number; endRow: number; startColumn: number; endColumn: number };
          from?: { subUnitId?: string; value?: unknown };
          to?: { subUnitId?: string; value?: unknown };
        }
      | undefined;
    if (!params || (params.unitId && params.unitId !== this.unitId)) return;
    if (command.id === M.setValues) {
      this.queue(params.subUnitId, cellsOf(params.cellValue));
    } else if (command.id === M.move) {
      this.queue(params.from?.subUnitId, cellsOf(params.from?.value));
      this.queue(params.to?.subUnitId, cellsOf(params.to?.value));
    } else if (command.id === M.reorder && params.subUnitId && params.range) {
      const { subUnitId, range } = params;
      queueMicrotask(() => this.onReorder(subUnitId, range));
    } else if (M.structural.has(command.id)) {
      this.events.rebuild();
    }
  }

  /**
   * Правки одной команды приходят несколькими мутациями (вставка, автозаполнение)
   * — собираем их и разбираем разом, когда команда закончится.
   */
  private queue(sheet: string | undefined, cells: Array<[number, number]>): void {
    if (!sheet || !cells.length || !this.models.has(sheet)) return;
    const set = this.queuedCells.get(sheet) ?? new Set<string>();
    for (const [row, column] of cells) set.add(`${row}:${column}`);
    this.queuedCells.set(sheet, set);
    if (this.queuedFlush) return;
    this.queuedFlush = true;
    queueMicrotask(() => {
      this.queuedFlush = false;
      const batches = [...this.queuedCells];
      this.queuedCells.clear();
      for (const [target, keys] of batches) {
        this.onUserCells(
          target,
          [...keys].map((key) => key.split(":").map(Number) as [number, number]),
        );
      }
    });
  }

  private worksheet(sheet: string): UniverApi | null {
    return this.api.getActiveWorkbook?.()?.getSheetBySheetId?.(sheet) ?? null;
  }

  /**
   * Ячейка как она хранится, а не как показана. `getCellData()` фасада
   * отдаёт ячейку после перехватчиков отрисовки: сумма там уже строка
   * «450 000», дата — «15.07.2026». Сравнение с листом по такой строке видело
   * бы правку в каждой денежной ячейке, которой коснулись хотя бы оформлением, —
   * и спрашивало бы «опечатка или с даты» на смене жирности.
   */
  private cellAt(ws: UniverApi, row: number, column: number): unknown {
    try {
      return ws.getRange(row, column, 1, 1).getCellDataGrid?.()?.[0]?.[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Какому блоку принадлежит строка без договора: карман, отступ, хвост листа. */
  private blockAt(model: SheetModel, row: number): number {
    const slot = model.slots[row];
    if (slot) return slot.block;
    return model.layout.blocks.length - 1;
  }

  /**
   * Что человек сделал с ячейками: напечатал, вставил, стёр, вернул Ctrl+Z.
   *
   * Вставка решается по первой строке. Легла на строки договоров — это правки,
   * по одной на договор. Дошла до кармана или пустой строки — всё, что ниже,
   * становится новыми договорами этого блока, а строки, на которые вставка
   * легла сверх того (шапка и договоры следующего блока), возвращаются на
   * место: вставка двенадцати строк в карман не должна переписать соседний блок.
   */
  private onUserCells(sheet: string, cells: Array<[number, number]>): void {
    const model = this.models.get(sheet);
    const ws = this.worksheet(sheet);
    if (!model || !ws) return;
    const byRow = new Map<number, number[]>();
    for (const [row, column] of cells) {
      const list = byRow.get(row) ?? [];
      list.push(column);
      byRow.set(row, list);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    const restore: number[] = [];
    const restoreTail: number[] = [];
    const asks: { id: string; key: string }[] = [];
    const fresh: CreateJob[] = [];
    let note = "";
    let newBlock: number | null = null;

    const edited: number[] = [];
    for (const row of rows) {
      const slot = model.slots[row];
      if (newBlock === null) {
        if (slot?.kind === "row") {
          note = this.editRow(model, ws, row, slot, byRow.get(row) ?? [], asks, restore) || note;
          edited.push(row);
          continue;
        }
        if (slot?.kind === "title" || slot?.kind === "header") {
          restore.push(row);
          note = "Шапку листа задаёт настройка реестра — здесь она не правится";
          continue;
        }
        if (slot?.kind === "gone") {
          restore.push(row);
          note = `${slot.text ?? "Договор ушёл"} — правьте его там`;
          continue;
        }
        newBlock = this.blockAt(model, row);
      }
      const block = model.layout.blocks[newBlock];
      const values: Record<string, string> = {};
      for (let column = 1; column < block.columns.length; column += 1) {
        const spec = block.columns[column];
        if (spec.readOnly) continue;
        const raw = rawOf(spec, this.cellAt(ws, row, column));
        if (raw) values[spec.key] = raw;
      }
      const isPocket = slot?.kind === "pocket" && slot.block === newBlock && !fresh.length;
      if (isPocket && slot) {
        // Напечатанное остаётся видно, пока договор заводится.
        const state = model.rows[row];
        if (state) for (const column of byRow.get(row) ?? []) state.canon[column] = canonOfCell(this.cellAt(ws, row, column));
        if (slot.job) {
          // Договор из этой строки уже заводится — допечатанное уйдёт следом.
          for (const column of byRow.get(row) ?? []) {
            const spec = block.columns[column];
            if (spec && !spec.readOnly) slot.job.later[spec.key] = rawOf(spec, this.cellAt(ws, row, column));
          }
          continue;
        }
      } else if (row < model.slots.length) {
        restore.push(row);
      } else {
        restoreTail.push(row);
      }
      if (Object.keys(values).length) fresh.push({ pocket: isPocket && slot ? slot : null, values });
    }

    // Правки уже в хранилище — берём их сразу, не дожидаясь React, и
    // переписываем строки по нему: напечатанное «1 500 000» становится суммой с
    // разрядами, заливки из буфера сходят, приглушённое ждёт ответа на вопрос.
    // Строки запоминаем объектами: сверка могла поставить новый договор выше
    // и сдвинуть номера.
    const redrawSlots = [...new Set([...restore, ...edited])].map((row) => model.slots[row]);
    this.sync(getRegistry());
    const redraw = redrawSlots.map((slot) => model.slots.indexOf(slot)).filter((row) => row >= 0);
    if (redraw.length) this.paint(model, redraw, "force");
    if (restoreTail.length) {
      const clear: Matrix = {};
      for (const row of restoreTail) {
        const line: Record<number, null> = {};
        for (let column = 0; column < model.layout.width; column += 1) line[column] = null;
        clear[row] = line;
      }
      this.exec(M.setValues, { unitId: this.unitId, subUnitId: sheet, cellValue: clear });
    }
    if (note) this.events.note(note, false);
    if (asks.length) this.events.ask({ sheet, items: asks, anchor: asks[0] });
    if (fresh.length && newBlock !== null) void this.runCreates(model, newBlock, fresh);
  }

  /** Правки строки договора. Возвращает текст для строки под листом, если есть. */
  private editRow(
    model: SheetModel,
    ws: UniverApi,
    row: number,
    slot: Slot,
    columns: number[],
    asks: { id: string; key: string }[],
    restore: number[],
  ): string {
    const id = slot.id ?? "";
    const contract = this.ctx.state.byId.get(id);
    if (!contract || contract.deleted) {
      restore.push(row);
      return "Договор убран — правка не записана";
    }
    const block = model.layout.blocks[slot.block];
    const state = model.rows[row];
    let note = "";
    let revert = false;
    for (const column of columns.sort((a, b) => a - b)) {
      const spec = block.columns[column];
      const cell = this.cellAt(ws, row, column);
      const typed = column === 0 ? `${canonOfCell(cell)}|${anchorKey((cell as { custom?: unknown } | null)?.custom)}` : canonOfCell(cell);
      if (state && typed === state.canon[column]) continue;
      if (!spec || spec.readOnly) {
        revert = true;
        if (spec?.kind === "ordinal") note = "Номер строки ставит лист";
        else if (spec) note = `«${spec.label}» — только для чтения`;
        continue;
      }
      if (state) state.canon[column] = typed;
      this.touch([{ id, key: spec.key }]);
      edit(id, spec.key, rawOf(spec, cell));
      if (getRegistry().edits.get(id)?.get(spec.key)?.state === "asking") asks.push({ id, key: spec.key });
    }
    if (revert) restore.push(row);
    return note;
  }

  /**
   * Новые договоры — по порядку, по одному запросу. Строка под листом считает:
   * «Заводим 12 договоров · 5». Первый договор из кармана встаёт на место
   * кармана, новый карман появляется под ним.
   */
  private async runCreates(model: SheetModel, block: number, jobs: CreateJob[]): Promise<void> {
    const sheet = model.layout.key;
    const total = jobs.length;
    const noun = (count: number) => plural(count, "договор", "договора", "договоров");
    this.creating.set(sheet, (this.creating.get(sheet) ?? 0) + 1);
    const failures: string[] = [];
    let done = 0;
    try {
      for (let index = 0; index < jobs.length; index += 1) {
        if (!this.alive) return;
        if (total > 1) this.events.note(`Заводим ${total} ${noun(total)} · ${index + 1}`);
        const job = jobs[index];
        const slot = job.pocket;
        const pocket = slot?.kind === "pocket" && slot.block === block && !slot.job ? slot : null;
        if (pocket) pocket.job = { later: {} };
        try {
          const id = await create(job.values, { view: sheet, block, source: "grid" });
          this.local.set(`${id}|*`, Date.now() + LOCAL_MS);
          done += 1;
          if (pocket) this.settlePocket(model, pocket, id);
          else this.transform(model, (slots) => this.insertBeforePocket(slots, block, id));
        } catch (exc) {
          const text = exc instanceof Error ? exc.message : "договор не заведён";
          failures.push(text);
          if (pocket) pocket.job = null;
        }
      }
    } finally {
      const left = (this.creating.get(sheet) ?? 1) - 1;
      if (left > 0) this.creating.set(sheet, left);
      else this.creating.delete(sheet);
      if (!left && model.recheck && this.alive) {
        model.recheck = false;
        this.structure(model, null);
      }
    }
    if (failures.length) {
      const more = failures.length > 1 ? ` · ещё отказов: ${failures.length - 1}` : "";
      this.events.note(`${done ? `Заведено ${done} ${noun(done)} · ` : ""}не заведено: ${failures[0]}${more}`, true);
    } else if (total > 1) {
      this.events.note(`Заведено ${done} ${noun(done)}`);
    }
  }

  private insertBeforePocket(slots: Slot[], block: number, id: string): Slot[] {
    if (slots.some((slot) => slot.kind === "row" && slot.id === id)) return slots;
    const at = slots.findIndex((slot) => slot.kind === "pocket" && slot.block === block);
    if (at < 0) return slots;
    const out = slots.slice();
    out.splice(at, 0, { kind: "row", block, id, here: true });
    return out;
  }

  /** Карман стал строкой договора; под ней — новый карман. */
  private settlePocket(model: SheetModel, pocket: Slot, id: string): void {
    const later = pocket.job?.later ?? {};
    const duplicate = model.slots.find((slot) => slot !== pocket && slot.kind === "row" && slot.id === id);
    pocket.kind = "row";
    pocket.id = id;
    pocket.here = true;
    pocket.job = null;
    reindex(model);
    if (duplicate) {
      // Договор уже успел встать строкой (пришёл опросом раньше ответа) —
      // лишнюю убираем.
      this.transform(model, (slots) => slots.filter((slot) => slot !== duplicate));
    }
    const row = model.slots.indexOf(pocket);
    if (row >= 0) this.paint(model, [row], "diff");
    this.transform(model, (slots) => {
      const at = slots.indexOf(pocket);
      if (at < 0) return slots;
      if (slots.some((slot) => slot.kind === "pocket" && slot.block === pocket.block)) return slots;
      const out = slots.slice();
      out.splice(at + 1, 0, { kind: "pocket", block: pocket.block });
      return out;
    });
    for (const [key, raw] of Object.entries(later)) {
      this.touch([{ id, key }]);
      edit(id, key, raw);
    }
  }

  /**
   * Сортировка. Univer переносит ячейки вместе с `custom` только внутри
   * сортируемого диапазона: вся ширина — строки договоров переехали целиком,
   * порядок принимается; часть ширины — договор разрезало бы надвое, и лист
   * возвращает строки на место. Шапка, название блока и карман сортировкой не
   * двигаются: если двинулись, это тоже возврат.
   */
  private onReorder(sheet: string, range: { startRow: number; endRow: number; startColumn: number; endColumn: number }): void {
    const model = this.models.get(sheet);
    const ws = this.worksheet(sheet);
    if (!model || !ws) return;
    const rows: number[] = [];
    for (let row = range.startRow; row <= range.endRow; row += 1) rows.push(row);
    const whole = range.startColumn <= 0 && range.endColumn >= model.layout.width - 1;
    const back = (text: string) => {
      this.paint(model, rows, "force");
      this.clearUndo();
      this.events.note(text, false);
    };
    if (!whole) {
      back("Сортируйте таблицу целиком: по одной колонке строки договоров разъехались бы — лист вернул порядок");
      return;
    }
    const byKey = new Map<string, Slot>();
    const loose: Slot[] = [];
    for (const row of rows) {
      const slot = model.slots[row];
      if (!slot) continue;
      const key = anchorKey(anchorOf(slot));
      if (key) byKey.set(key, slot);
      else loose.push(slot);
    }
    let anchors: unknown[][] = [];
    try {
      anchors = ws.getRange(range.startRow, 0, rows.length, 1).getCellDatas?.() ?? [];
    } catch {
      anchors = [];
    }
    const next = model.slots.slice();
    let ok = anchors.length === rows.length;
    rows.forEach((row, index) => {
      if (!ok || row >= next.length) return;
      const key = anchorKey((anchors[index]?.[0] as { custom?: unknown } | null)?.custom);
      const slot = key ? byKey.get(key) : loose.shift();
      if (!slot) {
        ok = false;
        return;
      }
      const was = model.slots[row];
      const body = (item: Slot) => item.kind === "row" || item.kind === "gone";
      if (body(slot) !== body(was) || (!body(slot) && slot !== was) || slot.block !== was.block) ok = false;
      next[row] = slot;
    });
    if (!ok) {
      back("Шапку и пустые строки блока сортировка не двигает — выделите только строки договоров");
      return;
    }
    model.slots = next;
    reindex(model);
    // Номера строк, заметки и стили — по новому порядку.
    this.paint(model, rows, "force");
    this.clearUndo();
  }

  // ── Вход на лист, выбор строки, карточка ──

  /**
   * Вход на лист: ушедшие строки убираются (фронт-план 4.7 — «убирается при
   * следующем входе в этот лист»), а хранилище забывает, кто куда ушёл.
   */
  private onSheetEntered(sheet: string): void {
    this.events.sheet(sheet);
    const model = this.models.get(sheet);
    if (!model) return;
    const state = this.ctx.state;
    const view = model.layout.key;
    this.transform(model, (slots) =>
      slots.filter((slot) => {
        if (slot.kind === "gone") return false;
        if (slot.kind !== "row" || !slot.id) return true;
        const contract = state.byId.get(slot.id);
        if (!contract || contract.deleted) return false;
        const stays = contract.views.some((place) => place.view === view && place.block === slot.block);
        if (stays) slot.here = false;
        return stays;
      }),
    );
    if (state.departed.size || state.fresh.size || state.wasIn?.size) forgetDeparted();
  }

  private onSelection(sheet: string, row: number | undefined): void {
    if (row === undefined) return;
    const slot = this.models.get(sheet)?.slots[row];
    window.clearTimeout(this.followTimer);
    if (!this.ctx.openId || slot?.kind !== "row" || !slot.id || slot.id === this.ctx.openId) return;
    const id = slot.id;
    const block = slot.block;
    // Карточка следует за листом с задержкой: стрелка по строкам не должна
    // мигать карточками.
    this.followTimer = window.setTimeout(() => {
      if (!this.alive || !this.ctx.openId) return;
      this.followed = id;
      this.events.openCard(id, { view: sheet, block });
    }, 150);
  }

  /**
   * Карточка открыта (или закрыта). Номер строки договора получает фон, пока
   * карточка открыта; лист прокручивается к строке один раз — при открытии, и
   * не тогда, когда карточку переключил сам лист выбором строки.
   */
  setOpen(id: string | null): void {
    const previous = this.ctx.openId;
    if (previous === id) return;
    this.ctx.openId = id;
    this.repaintIds([previous, id].filter((item): item is string => Boolean(item)));
    const followed = this.followed === id;
    this.followed = null;
    if (!id || followed) return;
    const ws = this.api.getActiveWorkbook?.()?.getActiveSheet?.();
    const row = ws ? this.models.get(ws.getSheetId())?.rowOf.get(id) : undefined;
    if (row === undefined || !ws) return;
    try {
      const visible = ws.getVisibleRange?.() as { startRow: number; endRow: number } | null;
      const top = visible ? visible.startRow + Math.floor((visible.endRow - visible.startRow) * 0.4) : -1;
      if (!visible || row < visible.startRow || row > top) ws.scrollToCell(Math.max(0, row - 2), 0);
    } catch {
      /* лист ещё не измерил себя */
    }
  }

  /** Alt+Enter: карточка договора активной строки. */
  openActive(): boolean {
    const ws = this.api.getActiveWorkbook?.()?.getActiveSheet?.();
    const range = ws?.getActiveRange?.();
    if (!ws || !range) return false;
    const sheet = ws.getSheetId();
    const slot = this.models.get(sheet)?.slots[range.getRow()];
    if (slot?.kind !== "row" || !slot.id) return false;
    this.followed = slot.id;
    this.events.openCard(slot.id, { view: sheet, block: slot.block });
    return true;
  }

  isEditing(): boolean {
    return this.editing !== null;
  }

  /** «Изменение с даты» в будущем: ячейка возвращается к прежнему, заметка говорит, что впереди. */
  markAhead(items: { id: string; key: string }[], text: (item: { id: string; key: string }) => string): void {
    for (const item of items) this.ctx.ahead.set(`${item.id}|${item.key}`, text(item));
    this.repaintIds(items.map((item) => item.id));
  }

  /** Подпись значения поля так, как её показывает лист («500 000», «ТОО Альфа»). */
  valueText(id: string, key: string, value: unknown): string {
    const schema = this.ctx.state.schema;
    const field = schema?.fields.find((item) => item.key === key) ?? null;
    if (!schema) return String(value ?? "");
    const column: SheetColumn = { key, label: key, width: 0, kind: kindOf(key, field), field, readOnly: false };
    const contract = this.ctx.state.byId.get(id);
    return faceText(faceOf(column, value, contract, { schema, parties: this.ctx.state.parties, people: this.ctx.state.people }));
  }

  // ── Слой вопроса над ячейкой ──

  private canvas(): HTMLCanvasElement | null {
    let best: HTMLCanvasElement | null = null;
    let area = 0;
    for (const node of this.host?.querySelectorAll("canvas") ?? []) {
      const box = node.getBoundingClientRect();
      if (box.width * box.height > area) {
        area = box.width * box.height;
        best = node;
      }
    }
    return best;
  }

  /**
   * Прокрутка основной области листа в координатах холста — по состоянию
   * прокрутки и накопленным высотам строк и ширинам колонок.
   *
   * Подписка `onScroll` здесь не годится: связка запускается сразу после
   * создания книги, когда отрисовки ещё нет, и Univer тихо возвращает пустую
   * подписку. Прокрутка оставалась нулевой, слой вопроса считал ячейку
   * суммы (колонка M, правее экрана) невидимой и закрывал вопрос в тот же
   * кадр — правка снималась, как по Esc, и человек видел, что сумма просто не
   * меняется.
   */
  private viewportScroll(ws: UniverApi): { x: number; y: number } {
    try {
      const state = ws.getScrollState?.() as
        | { sheetViewStartRow?: number; sheetViewStartColumn?: number; offsetX?: number; offsetY?: number }
        | undefined;
      const skeleton = ws.getSkeleton?.() as
        | { rowHeightAccumulation?: number[]; columnWidthAccumulation?: number[] }
        | undefined;
      const startRow = state?.sheetViewStartRow ?? 0;
      const startColumn = state?.sheetViewStartColumn ?? 0;
      const rowTop = startRow > 0 ? skeleton?.rowHeightAccumulation?.[startRow - 1] ?? 0 : 0;
      const columnLeft = startColumn > 0 ? skeleton?.columnWidthAccumulation?.[startColumn - 1] ?? 0 : 0;
      return { x: columnLeft + (state?.offsetX ?? 0), y: rowTop + (state?.offsetY ?? 0) };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  /**
   * Где на экране ячейка вопроса. Тот же расчёт, что у всплывающих слоёв
   * самого Univer: координата ячейки на холсте минус прокрутка, в масштабе,
   * от угла холста. `visible: false` — ячейка ушла из видимой части листа.
   */
  rectOf(group: AskGroup): { left: number; top: number; right: number; bottom: number; visible: boolean } | null {
    const ws = this.api.getActiveWorkbook?.()?.getActiveSheet?.();
    if (!ws || ws.getSheetId() !== group.sheet) return null;
    const model = this.models.get(group.sheet);
    const row = model?.rowOf.get(group.anchor.id);
    if (!model || row === undefined) return null;
    const column = model.layout.blocks[model.slots[row].block]?.columns.findIndex((item) => item.key === group.anchor.key) ?? -1;
    if (column < 0) return null;
    const canvas = this.canvas();
    let cell: { startX: number; startY: number; endX: number; endY: number } | null = null;
    try {
      cell = ws.getRange(row, column, 1, 1).getCell?.() ?? null;
    } catch {
      cell = null;
    }
    if (!canvas || !cell) return null;
    const box = canvas.getBoundingClientRect();
    const cssWidth = parseFloat(canvas.style.width) || box.width;
    const zoom = Number(ws.getZoom?.() ?? 1) || 1;
    const scale = (box.width / cssWidth) * zoom;
    const scroll = this.viewportScroll(ws);
    const left = (cell.startX - scroll.x) * scale + box.left;
    const right = (cell.endX - scroll.x) * scale + box.left;
    const top = (cell.startY - scroll.y) * scale + box.top;
    const bottom = (cell.endY - scroll.y) * scale + box.top;
    let visible = bottom > box.top && top < box.bottom && right > box.left && left < box.right;
    try {
      const range = ws.getVisibleRange?.() as { startRow: number; endRow: number; startColumn: number; endColumn: number } | null;
      if (range) {
        visible = visible && row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn;
      }
    } catch {
      /* без видимого диапазона — по холсту */
    }
    return { left, top, right, bottom, visible };
  }

  /** После ответа на вопрос фокус возвращается в лист. */
  focus(): void {
    const target = this.host?.querySelector<HTMLElement>("[data-u-comp='editor'], .univer-editor, canvas");
    target?.focus?.();
  }

  private retheme(): void {
    if (!this.alive) return;
    const pal = paletteNow();
    if (pal.dark === this.ctx.pal.dark && pal.fail === this.ctx.pal.fail && pal.flash === this.ctx.pal.flash) return;
    this.ctx.pal = pal;
    try {
      this.api.toggleDarkMode?.(pal.dark);
    } catch {
      /* останется прежняя тема холста */
    }
    // Цвета токенов (отказ, вспышка, строка карточки) зашиты в ячейки —
    // переписываем только их.
    for (const model of this.models.values()) {
      const rows: number[] = [];
      model.rows.forEach((state, row) => {
        if (state?.marks.some((mark) => /[FLO]/.test(mark))) rows.push(row);
      });
      if (rows.length) this.paint(model, rows, "force");
    }
  }
}
