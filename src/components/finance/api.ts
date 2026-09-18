/**
 * Клиент раздела «Финансы».
 *
 * `credentials: "include"` обязателен: маршруты закрыты правом «finance» за
 * логином дашборда, и без куки каждый запрос вернул бы 401.
 *
 * Ошибки разворачиваются в текст один раз здесь, а не в каждом экране. FastAPI
 * кладёт человеческое объяснение в `detail`, и оно бывает единственным, что
 * человек увидит: «счёт не найден», «операцию уже изменили». Показать вместо
 * него «Request failed with status 400» — значит потерять смысл отказа.
 */
const API = "/api/backend/api/v1/finance";

export type Money = string;

export type Account = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  starting_balance: Money;
  excluded_from_reports: boolean;
};

export type AccountBalance = Account & {
  balance: Money;
  balance_with_plan: Money;
};

export type DictEntry = { id: string; name: string };
export type Category = DictEntry & { side: "income" | "expense"; system_key: string };
export type Counterparty = DictEntry & { role: string };
export type Project = DictEntry & { closed: boolean };

export type Dictionaries = {
  accounts: Account[];
  categories: Category[];
  counterparties: Counterparty[];
  projects: Project[];
  tags: DictEntry[];
};

export type Company = { id: string; title: string; role: string };

export type Me = {
  authenticated: boolean;
  user?: { id: string; email: string; full_name: string; must_change_password: boolean };
  company?: Company | null;
  companies?: Company[];
  /** Что человеку можно: read | write | accounts | people | company. */
  abilities?: string[];
};

export type MemberRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  role: string;
};

export type SessionRow = {
  id: string;
  created_at: string | null;
  last_seen_at: string | null;
  user_agent: string;
};

export type Overview = {
  workspace: { id: string; title: string; currency: string };
  accounts: AccountBalance[];
  total: Money;
  total_with_plan: Money;
  receivable: Money;
  payable: Money;
  overdue_receivable: Money;
  planned_count: number;
  planned_preview: { id: string; kind: string; paid_at: string; amount: Money; comment: string }[];
};

export type OperationKind = "income" | "expense" | "transfer";

export type Operation = {
  id: string;
  version: number;
  kind: OperationKind;
  status: "fact" | "plan";
  paid_at: string;
  accrued_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: Money;
  currency: string;
  amount_base: Money;
  account_from: string;
  account_to: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category: string;
  category_id: string | null;
  counterparty: string;
  counterparty_id: string | null;
  projects: { id: string; name: string; amount: Money }[];
  split_state: string;
  tags: string[];
  comment: string;
  source: string;
  import_batch_id: string | null;
};

export type OperationPage = {
  total: number;
  limit: number;
  offset: number;
  sums: { income: Money; expense: Money };
  items: Operation[];
};

export type CashFlowRow = {
  month: string;
  start_balance: Money;
  income: Money;
  expense: Money;
  net: Money;
  end_balance: Money;
  income_plan: Money;
  expense_plan: Money;
  end_balance_with_plan: Money;
};

export type BreakdownItem = {
  name: string;
  /** Только факт. Ожидания живут отдельно — см. `planned` и `months_plan`. */
  total: Money;
  planned: Money;
  months: Record<string, Money>;
  months_plan: Record<string, Money>;
};

export type Check = { name: string; ok: boolean; left: string; right: string; hint?: string };

export type CashFlow = {
  months: string[];
  opening_balance: Money;
  closing_balance: Money;
  rows: CashFlowRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
  checks: Check[];
};

export type ProfitRow = {
  month: string;
  income: Money;
  expense: Money;
  profit: Money;
  income_fact: Money;
  expense_fact: Money;
  margin: string;
};

export type Profit = {
  months: string[];
  rows: ProfitRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
};

export type DebtItem = {
  id: string;
  due: string;
  accrued: string;
  amount: Money;
  counterparty: string;
  category: string;
  comment: string;
  overdue_days: number;
};

export type DebtSide = {
  total: Money;
  overdue: Money;
  by_counterparty: { name: string; amount: Money }[];
  items: DebtItem[];
};

export type Debts = { as_of: string; receivable: DebtSide; payable: DebtSide };

export type ProjectsReport = {
  items: { name: string; income: Money; expense: Money; profit: Money; margin: string }[];
  not_split: { income: Money; expense: Money; note: string };
};

export type CalendarDay = {
  date: string;
  income: Money;
  expense: Money;
  income_plan: Money;
  expense_plan: Money;
  balance: Money;
  negative: boolean;
};

export type CalendarMonth = {
  month: string;
  opening_balance: Money;
  days: CalendarDay[];
  cash_gaps: string[];
};

export type PlanCell = {
  month: string;
  fact: Money;
  plan: Money;
  deviation: Money;
  /** Пусто, когда плана нет: «∞%» на месте процента читается как сбой расчёта. */
  done_pct: string | null;
};

export type PlanItem = {
  side: "income" | "expense";
  key: string;
  name: string;
  cells: PlanCell[];
  fact_total: Money;
  plan_total: Money;
};

export type PlanActual = { months: string[]; method: string; items: PlanItem[] };

export type GridColumn = {
  key: string;
  title: string;
  kind: string;
  width: number;
  editable: boolean;
  source: string;
};

export type GridPayload = {
  columns: GridColumn[];
  rows: { id: string; version: number; cells: Record<string, string>; kind: string; status: string; split_count: number }[];
  options: Record<string, string[]>;
  total: number;
};

export type RuleCondition = { field: string; op: string; value: string };

export type Rule = {
  id: string;
  name: string;
  active: boolean;
  match: string;
  conditions: RuleCondition[];
  actions: Record<string, string>;
  /** Сколько операций правило разметило. Ноль у включённого — условие не совпадает. */
  applied_count: number;
  position: number;
};

export type RuleSuggestion = {
  keyword: string;
  kind: string;
  count: number;
  amount: Money;
  examples: string[];
};

export type ImportProblem = { field: string; text: string };

export type ImportRow = {
  line: number;
  state: "imported" | "skipped" | "failed" | "duplicate";
  problems: ImportProblem[];
  values: Record<string, unknown>;
  raw: Record<string, unknown>;
  operation_id?: string | null;
};

export type ImportQuestion = {
  kind: string;
  title: string;
  text: string;
  samples: string[];
  options: { value: string; label: string; example: string }[];
};

/** Книга Google, открытая сервисному аккаунту программы. */
export type SheetBook = { id: string; name: string; modified?: string };
export type SheetTab = { title: string; sheet_id: number; rows: number; cols: number; hidden?: boolean };

export type ImportPreview = {
  batch_id: string;
  file_name: string;
  header_line: number;
  counts: { total: number; ready: number; failed: number; skipped: number };
  question: ImportQuestion | null;
  /** Что разметили правила: «название правила» → сколько строк. */
  rules_applied?: Record<string, number>;
  date_order: string;
  date_evidence: string;
  mapping: { columns: Record<string, { index: number; header: string; how: string }>; width: number };
  unused_columns: string[];
  accounts_missing: string[];
  rows: ImportRow[];
};

export type ImportBatch = {
  id: string;
  file_name: string;
  status: string;
  created_at: string | null;
  applied_at: string | null;
  rows_total: number;
  rows_imported: number;
  rows_failed: number;
  rows_skipped: number;
  rows_duplicate: number;
  decisions: Record<string, unknown>;
};

export class FinanceApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    let message = `Сервер ответил ${response.status}`;
    try {
      const body = await response.json();
      // `detail` у FastAPI бывает и строкой, и списком ошибок валидации.
      if (typeof body?.detail === "string") message = body.detail;
      else if (Array.isArray(body?.detail)) {
        message = body.detail.map((item: { msg?: string }) => item?.msg ?? "").filter(Boolean).join("; ") || message;
      }
    } catch {
      /* тело не JSON — оставляем код состояния */
    }
    throw new FinanceApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

export const financeApi = {
  // ── Учётки ───────────────────────────────────────────────────────────────
  me: () => request<Me>("/auth/me"),
  login: (body: { email: string; password: string }) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body: { email: string; password: string; company: string; full_name?: string }) =>
    request<Me>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  switchCompany: (companyId: string) =>
    request<Me>("/auth/switch", { method: "POST", body: JSON.stringify({ company_id: companyId }) }),
  addCompany: (title: string) =>
    request<Company>("/auth/companies", { method: "POST", body: JSON.stringify({ title }) }),
  renameCompany: (title: string) =>
    request<{ id: string; title: string }>("/auth/company", {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  members: () => request<{ items: MemberRow[] }>("/auth/members"),
  invite: (body: { email: string; password: string; role: string; full_name?: string }) =>
    request<{ id: string; email: string; role: string }>("/auth/members", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  changeRole: (userId: string, role: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  removeMember: (userId: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, { method: "DELETE" }),
  changePassword: (body: { old_password: string; new_password: string }) =>
    request<{ ok: boolean }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
  sessions: () => request<{ items: SessionRow[] }>("/auth/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" }),

  overview: () => request<Overview>("/overview"),
  dictionaries: () => request<Dictionaries>("/dictionaries"),

  operations: (params: Record<string, string | number | undefined>) =>
    request<OperationPage>(`/operations${qs(params)}`),
  createOperation: (body: unknown) =>
    request<Operation>("/operations", { method: "POST", body: JSON.stringify(body) }),
  patchOperation: (id: string, body: unknown) =>
    request<Operation>(`/operations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteOperation: (id: string) => request<{ ok: boolean }>(`/operations/${id}`, { method: "DELETE" }),

  grid: (params: Record<string, string | number | undefined>) =>
    request<GridPayload>(`/grid${qs(params)}`),
  patchCell: (body: { operation_id: string; column: string; value: unknown; version?: number }) =>
    request<Operation>("/grid/cell", { method: "PATCH", body: JSON.stringify(body) }),
  addGridRow: (cells: Record<string, unknown>) =>
    request<Operation>("/grid/row", { method: "POST", body: JSON.stringify({ cells }) }),

  cashFlow: (params: Record<string, string | undefined>) =>
    request<CashFlow>(`/reports/cash-flow${qs(params)}`),
  profit: (params: Record<string, string | undefined>) =>
    request<Profit>(`/reports/profit${qs(params)}`),
  debts: (params: Record<string, string | undefined> = {}) =>
    request<Debts>(`/reports/debts${qs(params)}`),
  projects: (params: Record<string, string | undefined> = {}) =>
    request<ProjectsReport>(`/reports/projects${qs(params)}`),
  calendar: (year: number, month: number) =>
    request<CalendarMonth>(`/reports/calendar${qs({ year, month })}`),
  planActual: (params: Record<string, string | undefined> = {}) =>
    request<PlanActual>(`/reports/plan-actual${qs(params)}`),
  upsertPlan: (body: {
    month: string;
    side: string;
    method: string;
    amount: string;
    category_id?: string | null;
    project_id?: string | null;
  }) => request<{ id: string; month: string; amount: Money }>("/plans", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  createEntry: (kind: "categories" | "counterparties" | "projects" | "tags", body: unknown) =>
    request<DictEntry>(`/dictionaries/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  createAccount: (body: unknown) =>
    request<DictEntry>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  archiveEntry: (kind: string, id: string) =>
    request<{ ok: boolean }>(`/dictionaries/${kind}/${id}`, { method: "DELETE" }),

  rules: () => request<{ items: Rule[] }>("/rules"),
  createRule: (body: {
    name: string;
    conditions: RuleCondition[];
    actions: Record<string, string>;
    match?: string;
  }) => request<{ id: string; name: string }>("/rules", { method: "POST", body: JSON.stringify(body) }),
  toggleRule: (id: string, active: boolean) =>
    request<{ id: string; active: boolean }>(`/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/rules/${id}`, { method: "DELETE" }),
  applyRules: (body: { only_uncategorized?: boolean } = {}) =>
    request<{ rules: number; updated: number; by_rule: Record<string, number> }>("/rules/apply", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ruleSuggestions: () => request<{ items: RuleSuggestion[] }>("/rules/suggest"),

  importPreview: (file: File, params: { date_order?: string; default_account?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportPreview>(`/import/preview${qs(params)}`, { method: "POST", body: form });
  },
  sheetBooks: () => request<{ configured: boolean; items: SheetBook[] }>("/sheets/books"),
  sheetBook: (id: string) =>
    request<{ id: string; title: string; url: string; tabs: SheetTab[] }>(`/sheets/books/${id}`),
  /** Вкладка книги разбирается тем же разбором, что и загруженный файл. */
  sheetPreview: (body: { book_id: string; tab: string; date_order?: string; default_account?: string }) =>
    request<ImportPreview>("/sheets/preview", { method: "POST", body: JSON.stringify(body) }),
  importBatches: () => request<{ items: ImportBatch[] }>("/import/batches"),
  importBatch: (id: string) =>
    request<{ id: string; file_name: string; status: string; counts: Record<string, number>; rows: ImportRow[]; decisions: Record<string, unknown> }>(
      `/import/batches/${id}`,
    ),
  applyBatch: (id: string, body: { lines?: number[]; create_dictionaries?: boolean } = {}) =>
    request<{ imported: number; failed: number; skipped: number; duplicate: number; total: number }>(
      `/import/batches/${id}/apply`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  fixImportRow: (id: string, line: number, patch: Record<string, unknown>) =>
    request<{ line: number; state: string; problems: ImportProblem[]; values: Record<string, unknown> }>(
      `/import/batches/${id}/rows/${line}`,
      { method: "PATCH", body: JSON.stringify({ patch }) },
    ),
};

/**
 * Деньги на экране: разряды пробелами, две цифры после запятой только когда
 * они есть.
 *
 * Копейки прячутся не для красоты. В управленческом отчёте суммы семизначные,
 * и «1 680 000,00» против «1 680 000» — это шум в каждой строке таблицы,
 * который мешает сравнивать порядки величин глазом. Там, где копейки есть, они
 * показываются: это не округление, а отсутствие ложной точности.
 */
export function formatMoney(value: Money | number, options: { sign?: boolean } = {}): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  const fraction = Math.abs(number % 1) > 0.0001 ? 2 : 0;
  const text = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: 2,
  }).format(Math.abs(number));
  const prefix = options.sign ? (number < 0 ? "−" : "+") : number < 0 ? "−" : "";
  return `${prefix}${text}`;
}

/**
 * Сумма для узкой полосы: «3,05 млн» вместо «3 050 000».
 *
 * Полоса шириной в палец, и полное число в ней либо обрезается, либо
 * набирается таким кеглем, что не читается. Точность здесь не нужна: это
 * взгляд «сколько всего», а точная цифра — в раскрытой панели.
 */
export function compactMoney(value: Money | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  const sign = number < 0 ? "−" : "";
  const abs = Math.abs(number);
  const round = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0).replace(".", ",").replace(/,0+$/, "");
  if (abs >= 1_000_000_000) return `${sign}${round(abs / 1_000_000_000)} млрд`;
  if (abs >= 1_000_000) return `${sign}${round(abs / 1_000_000)} млн`;
  if (abs >= 10_000) return `${sign}${round(abs / 1_000)} тыс`;
  return `${sign}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(abs)}`;
}

/** «2026-09» → «сентябрь 2026»; для шапок таблиц — «сен 26». */
export function formatMonth(month: string, short = false): string {
  const [year, index] = month.split("-").map(Number);
  const full = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!index || index < 1 || index > 12) return month;
  return short ? `${brief[index - 1]} ${String(year).slice(2)}` : `${full[index - 1]} ${year}`;
}

/** «2026-09-17» → «17 сен 2026». */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!month || month < 1 || month > 12) return iso;
  return `${day} ${brief[month - 1]} ${year}`;
}

/** Первое и последнее число месяца, сдвинутого на `shift` от текущего. */
export function monthEdges(shift = 0): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + shift + 1, 0);
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
