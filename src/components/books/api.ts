/**
 * Клиент раздела «Книги».
 *
 * `credentials: "include"` обязателен: маршруты за логином дашборда, и без
 * куки каждый запрос вернул бы 401. Это отличает раздел от «Таблиц», куда
 * сейчас пускают кого угодно.
 */
const API = "/api/backend/api/v1/books";

export type SourceBook = { id: string; title: string };
export type SourceTab = { id: string; title: string; rows: number; cols: number };
export type SourceMeta = { id: string; title: string; tabs: SourceTab[] };

export type Book = {
  id: string;
  title: string;
  source_kind: string;
  source_ref: string;
  imported_at: string | null;
  /** Вкладки приходят сразу: их единицы, а запрос на каждую книгу — это N+1. */
  tables: { id: string; name: string }[];
};

export type FieldStats = {
  filled?: number;
  scanned?: number;
  fill_ratio?: number;
  distinct?: number;
  examples?: string[];
  separator?: boolean;
};

export type BoardField = {
  key: string;
  title: string;
  type: string;
  position: number;
  stats: FieldStats;
  role: string | null;
  confirmed: boolean;
  suggestion: { role: string; confidence: string; reason: string } | null;
};

export type BoardRole = {
  key: string;
  title: string;
  value_type: string;
  description: string;
  bound_to: string | null;
};

export type BoardSection = {
  key: string;
  title: string;
  computes: boolean;
  /** Все обязательные роли раздела — чтобы отличить «сломан» от «не про эту книгу». */
  required: string[];
  /** Сколько обязательных ролей раздел получил именно отсюда. */
  bound_required: number;
  missing_required: string[];
  missing_titles: string[];
};

export type Board = {
  table: { id: string; name: string; header_row: number };
  fields: BoardField[];
  roles: BoardRole[];
  sections: BoardSection[];
  refusals: { kind: string; role: string; fields: string[]; reason: string }[];
  unbound: string[];
};

export type Field = {
  key: string;
  title: string;
  type: string;
  position: number;
  /** Значения колонки-списка, собранные при импорте. Пусто — колонка не список. */
  options: string[];
};

export type Row = {
  id: string;
  values: Record<string, unknown>;
  origin: string;
  state: string;
  version: number;
  updated_at?: string | null;
};

export type TableView = {
  /** Чем можно отобрать эту книгу. Пусто — отбирать нечем. */
  facets?: Facet[];
  table: { id: string; name: string; book_id: string; header_row: number };
  fields: Field[];
  bindings: Record<string, string>;
  /** Ключ роли → её русское название. Ключи в интерфейс не попадают. */
  role_titles: Record<string, string>;
  total: number;
  rows: Row[];
};

export type Preview = {
  run_id: string;
  table_id: string;
  book_id: string;
  summary: Record<string, number>;
  alignment: Record<string, number>;
  describe: string;
  blocked: boolean;
  blocked_reason: string;
  issues: { kind: string; key: string; detail: Record<string, unknown> }[];
};

/**
 * Текст ошибки разворачивается до того, как попадёт наверх.
 *
 * FastAPI кладёт человеческую формулировку в `detail` — «Google не даёт доступ
 * к книге», «книгу изменили, пока вы смотрели предпросмотр». Без разворачивания
 * на экран попадало бы «HTTP 502», по которому нельзя понять ни что случилось,
 * ни пройдёт ли оно само.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: init?.body
      ? { "Content-Type": "application/json", ...init?.headers }
      : init?.headers,
  });
  if (!response.ok) {
    let detail = `Не удалось связаться с сервером (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* тело не JSON — остаётся код статуса */
    }
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

/**
 * Три порядка строк, каждый под свою поверхность.
 *
 * `position` — порядок самой книги, для таблицы: строка обязана оставаться
 * там, где стояла, иначе правка ячейки телепортирует её под руками.
 * `date` — хроникой по дате операции, для карточек: журнал читается по дням.
 * `recent` — по времени правки, для «что я только что вводил».
 */
export type RowOrder = "position" | "date" | "recent";

/** Чем сузили книгу: величины и период. */
export type Picked = {
  /** {ключ роли: выбранное значение}. Пустая строка означает «не выбрано». */
  by?: Record<string, string>;
  since?: string;
  until?: string;
};

/** Величина, по которой можно отобрать книгу, и значения, что в ней есть. */
export type Facet = { role: string; title: string; values: string[] };

export const booksApi = {
  sources: () => request<{ books: SourceBook[] }>("/sources"),
  sourceTabs: (id: string) => request<SourceMeta>(`/sources/${encodeURIComponent(id)}`),
  refreshSources: () => request<{ ok: boolean }>("/sources/refresh", { method: "POST" }),

  books: () => request<{ books: Book[] }>(""),
  /**
   * Страница строк вкладки.
   *
   * `order: "recent"` — свежие сверху; так открываются карточки, где человек
   * смотрит на то, что вводили последним. Грид держит порядок самой книги
   * (`position`): в нём строка обязана оставаться там, где стояла, иначе
   * правка ячейки телепортирует строку наверх прямо под руками.
   *
   * `q` ищет по всей вкладке на сервере. Фильтровать загруженное на фронте
   * нельзя: в журнале на 3634 строки это давало правдоподобный неполный ответ.
   */
  table: (
    tableId: string,
    limit = 100,
    offset = 0,
    order: RowOrder = "position",
    q = "",
    picked: Picked = {},
  ) => {
    const parts = [`limit=${limit}`, `offset=${offset}`, `order=${order}`];
    if (q) parts.push(`q=${encodeURIComponent(q)}`);
    // Отбор — «роль:значение». Роль, а не имя колонки: у следующей компании
    // колонка называется иначе, а фирма остаётся фирмой.
    for (const [role, value] of Object.entries(picked.by ?? {})) {
      if (value) parts.push(`f=${encodeURIComponent(`${role}:${value}`)}`);
    }
    if (picked.since) parts.push(`since=${picked.since}`);
    if (picked.until) parts.push(`until=${picked.until}`);
    return request<TableView>(`/tables/${tableId}?${parts.join("&")}`);
  },
  board: (tableId: string) => request<Board>(`/tables/${tableId}/board`),

  /**
   * Колонки книги. Менять их может только администратор — сервер закрывает эти
   * маршруты отдельно, потому что колонка общая: убравший «Проект» убрал бы его
   * у всех, кто ведёт книгу, и заодно из расчётов дашборда.
   *
   * `after` — ключ колонки, следом за которой встать. Смысл пустого значения у
   * двух операций разный и объявлен на сервере: при заведении это «в конец»
   * (так дописывают столбец в любой таблице), при переносе — «в самое начало»,
   * иначе первую позицию занять было бы нечем.
   */
  addField: (
    tableId: string,
    field: { title: string; type?: string; after?: string | null },
  ) =>
    request<Field>(`/tables/${tableId}/fields`, {
      method: "POST",
      body: JSON.stringify(field),
    }),

  updateField: (
    tableId: string,
    key: string,
    patch: { title?: string; type?: string; after?: string | null; move?: boolean },
  ) =>
    request<Field>(`/tables/${tableId}/fields/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /** Сколько строк держат значение в колонке — вопрос ПЕРЕД её удалением. */
  fieldUsage: (tableId: string, key: string) =>
    request<{ filled: number }>(
      `/tables/${tableId}/fields/${encodeURIComponent(key)}/usage`,
    ),

  removeField: (tableId: string, key: string) =>
    request<{ hidden: number }>(
      `/tables/${tableId}/fields/${encodeURIComponent(key)}`,
      { method: "DELETE" },
    ),

  bind: (tableId: string, fieldKey: string, roleKey: string | null) =>
    request<Board>(`/tables/${tableId}/bindings`, {
      method: "PUT",
      body: JSON.stringify({ field_key: fieldKey, role_key: roleKey }),
    }),

  createRow: (tableId: string, values: Record<string, unknown>) =>
    request<Row>(`/tables/${tableId}/rows`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  /**
   * `version` — оптимистичная блокировка. Таблица и карточки правят одни и те
   * же строки, и правят их несколько человек сразу; без неё тот, кто нажал
   * «сохранить» вторым, молча затирал бы чужую правку.
   *
   * В ответ приходит строка целиком — оба вида держат один список в памяти и
   * кладут в него ровно то, что записалось, не перечитывая страницу.
   */
  updateRow: (
    tableId: string,
    rowId: string,
    values: Record<string, unknown>,
    version: number,
  ) =>
    request<Row>(`/tables/${tableId}/rows/${rowId}`, {
      method: "PATCH",
      body: JSON.stringify({ values, version }),
    }),

  deleteRow: (tableId: string, rowId: string, version: number) =>
    request<{ ok: boolean }>(
      `/tables/${tableId}/rows/${rowId}?version=${version}`,
      { method: "DELETE" },
    ),

  preview: (spreadsheetId: string, tab: string) =>
    request<Preview>("/import/preview", {
      method: "POST",
      body: JSON.stringify({ spreadsheet_id: spreadsheetId, tab }),
    }),
  apply: (spreadsheetId: string, tab: string, runId: string) =>
    request<{ applied: Record<string, number>; table_id: string }>("/import/apply", {
      method: "POST",
      body: JSON.stringify({ spreadsheet_id: spreadsheetId, tab, run_id: runId }),
    }),
};

/** Подпись типа поля для человека. */
export const TYPE_LABEL: Record<string, string> = {
  text: "текст",
  number: "число",
  money: "деньги",
  date: "дата",
  bool: "флажок",
  enum: "список",
  formula: "формула",
  unknown: "пусто",
};

/** Чем обоснована предложенная привязка. */
export const CONFIDENCE_LABEL: Record<string, string> = {
  exact: "точное совпадение заголовка",
  squashed: "совпадение без учёта знаков",
  loose: "похожий заголовок",
  manual: "выбрано вручную",
};
