import type { WorkbookSnapshot } from "@/components/univer/sheet";

/** Одна вкладка, как её отдаёт `GET /sources/{id}/tab`. */
export type TabPayload = {
  spreadsheet_id: string;
  spreadsheet_title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: Record<string, any>;
  styles: Record<string, unknown>;
  fonts?: string[];
  checkboxes?: CellRange[];
};

type CellRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/**
 * Имя ресурса, под которым плагин проверки данных Univer хранит свои правила.
 * Совпадает с `DATA_VALIDATION_PLUGIN_NAME` в @univerjs/data-validation —
 * константа там не экспортируется, поэтому вписана строкой.
 */
const DATA_VALIDATION_RESOURCE = "SHEET_DATA_VALIDATION_PLUGIN";

/**
 * Собрать книгу Univer из вкладок, загруженных поштучно.
 *
 * Ровно то же, что делает `build_workbook` в `app/webexcel/univer.py`, только
 * на клиенте. Дублирование здесь оправдано: собирать книгу на бэкенде значит
 * тянуть все вкладки в одном запросе, а одна вкладка «Журнала» читается восемь
 * секунд, у «Осн.Общей сводки» вкладок 23, и прокси Next рвёт запрос на 180
 * секундах. Повкладочная загрузка снимает и потолок времени, и пиковый объём
 * ответа, и заодно даёт человеку видеть, что идёт, а не пустой экран на три
 * минуты.
 *
 * Единственное, что здесь по-настоящему важно: **реестры стилей вкладок
 * независимы**. У каждой свои `"1"`, `"2"`, `"3"`, означающие разное. Склеить
 * их «как есть» значит перекрасить первую вкладку в цвета второй — молча и
 * целиком. Поэтому при переносе id перенумеровываются.
 */
export function assembleWorkbook(
  spreadsheetId: string,
  title: string,
  tabs: TabPayload[],
): { workbook: WorkbookSnapshot; fonts: string[] } {
  const styles: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets: Record<string, any> = {};
  const order: string[] = [];
  const fonts = new Set<string>();
  // Правила проверки данных лежат не в листах, а в отдельном ресурсе книги,
  // разложенном по id листов.
  const validation: Record<string, Array<Record<string, unknown>>> = {};

  tabs.forEach((tab, index) => {
    (tab.fonts ?? []).forEach((font) => fonts.add(font));

    const remap = new Map<string, string>();
    for (const [localId, style] of Object.entries(tab.styles ?? {})) {
      const globalId = String(Object.keys(styles).length + 1);
      styles[globalId] = style;
      remap.set(localId, globalId);
    }

    const sheet = tab.sheet;
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const cell of Object.values(row as Record<string, { s?: string }>)) {
        if (cell.s !== undefined) {
          const mapped = remap.get(cell.s);
          if (mapped !== undefined) cell.s = mapped;
        }
      }
    }

    // Google допускает две вкладки с одинаковым sheetId в разных книгах, а мы
    // складываем их в один объект по ключу. Индекс в хвосте гарантирует, что
    // вторая вкладка не затрёт первую.
    const id = sheets[sheet.id] ? `${sheet.id}-${index}` : sheet.id;
    sheet.id = id;
    sheets[id] = sheet;
    order.push(id);

    // Флажки Google — это ячейки с условием BOOLEAN, а не значение TRUE.
    // Без правила проверки данных колонка приезжает столбцом слова «TRUE»
    // вместо галочек, как её и увидели на первой же импортированной книге.
    const boxes = tab.checkboxes ?? [];
    if (boxes.length) {
      validation[id] = [
        { uid: `gs-checkbox-${id}`, type: "checkbox", ranges: boxes },
      ];
    }
  });

  return {
    workbook: {
      id: `gs-${spreadsheetId}`,
      name: title,
      locale: "ruRU",
      sheetOrder: order,
      sheets,
      styles,
      resources: Object.keys(validation).length
        ? [{ name: DATA_VALIDATION_RESOURCE, data: JSON.stringify(validation) }]
        : [],
      custom: { source: "google-sheets", spreadsheetId },
    },
    fonts: [...fonts],
  };
}
