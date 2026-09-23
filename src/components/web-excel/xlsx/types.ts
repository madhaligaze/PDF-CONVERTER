/**
 * Что возвращает разбор файла .xlsx — общая форма для потока разбора и экрана.
 *
 * Лист приходит уже в формате Univer (`IWorksheetData`), но со СВОИМ реестром
 * стилей: у каждого листа свои «1», «2», «3», и при сборке книги они
 * перенумеровываются (`../workbook.ts`). Выпадающие списки и флажки лежат
 * рядом, а не внутри листа: их ставит API Univer после создания книги.
 */

export type CellRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/** Выпадающий список книги: состав, клетки и то, как он себя ведёт. */
export type SheetList = {
  values: string[];
  ranges: CellRange[];
  /** «Запрещать ввод данных» — не из списка нельзя. Иначе только предупреждение. */
  strict: boolean;
  /** Текст справки, который Google показывает у выбранной ячейки. */
  prompt?: string;
};

export type ImportStats = {
  rows: number;
  cols: number;
  /** Строк и колонок в исходнике — больше, если лист обрезан потолком. */
  sourceRows: number;
  sourceCols: number;
  truncated: boolean;
  /** Формулы, замененные значением: чужие функции Google или ссылки на невзятые листы. */
  frozenFormulas: number;
};

export type ImportedSheet = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: Record<string, any>;
  styles: Record<string, unknown>;
  lists: SheetList[];
  checkboxes: CellRange[];
  fonts: string[];
  stats: ImportStats;
};

/** Оглавление файла — до выбора листов. */
export type SheetSummary = {
  name: string;
  rows: number;
  cols: number;
  hidden: boolean;
};

export type WorkerRequest =
  | { kind: "load"; buffer: ArrayBuffer }
  | { kind: "convert"; names: string[] };

export type WorkerResponse =
  | { kind: "loaded"; title: string; sheets: SheetSummary[] }
  | { kind: "converted"; sheets: ImportedSheet[] }
  | { kind: "failed"; message: string };
