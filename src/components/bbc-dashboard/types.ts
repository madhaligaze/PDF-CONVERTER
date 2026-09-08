/**
 * BBC Dashboard — API contracts.
 * Mirrors backend/app/bbc/schemas.py and the dataset payload. Keep both in sync.
 */

/* ── Access ─────────────────────────────────────────────────────────────────── */

/**
 * Один открытый заход в дашборд.
 *
 * `user_agent` приходит вместе с разобранным `device` намеренно: разбор — это
 * догадка по строке, которую браузер сообщает о себе сам, и когда он говорит
 * «неизвестное устройство», человеку нужно чем-то это перепроверить.
 */
export type BbcSession = {
  id: string;
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  /** Заход этого же человека. У сотрудника всегда true, у админа — не всегда. */
  mine: boolean;
  /** Тот самый заход, из которого открыт экран. Завершить его — выйти. */
  current: boolean;
  device: string;
  mobile: boolean;
  user_agent: string;
  ip: string;
  created_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
};

export type BbcMe = {
  authenticated: boolean;
  username: string | null;
  role: string | null;
  /** Set when the caller arrived through a department referral link. */
  link_label: string | null;
  /** Когда эта ссылка перестанет работать. null — бессрочная. */
  link_expires_at?: string | null;
  departments: string[];
  blocks: string[];
  is_admin: boolean;
  /** True before the first admin exists — the UI offers initial setup. */
  needs_setup: boolean;
  /** Человеческое имя сотрудника — подпись под касанием. */
  full_name?: string;
  /** `own` | `department` | `all` — чьи строки видно. */
  data_scope?: BbcDataScope;
  /**
   * Пароль выдан админом и ещё не сменён. Оболочка показывает экран смены
   * пароля вместо дашборда — данных за ним всё равно нет, область видимости
   * такой учётки пуста.
   */
  must_change_password?: boolean;
};

/* ── Сотрудники ─────────────────────────────────────────────────────────────── */

export type BbcDataScope = "own" | "department" | "all";

export type BbcEmployee = {
  id: number;
  username: string;
  full_name: string;
  role: string;
  /** `active` | `dismissed`. Увольнение мягкое: касания остаются в журнале. */
  status: string;
  must_change_password: boolean;
  departments: string[];
  blocks: string[];
  data_scope: BbcDataScope;
  /** Написания этого человека в колонке «Сотрудник» таблицы. */
  employee_aliases: string[];
  created_at: string | null;
  password_changed_at: string | null;
};

export type BbcEmployeeForm = {
  username?: string;
  full_name: string;
  departments: string[];
  blocks: string[];
  data_scope: BbcDataScope;
  employee_aliases: string[];
};

/**
 * Ответ на создание и на сброс пароля.
 *
 * `temp_password` приходит ровно здесь и больше нигде: в базе только
 * argon2-хеш, повторно узнать пароль нельзя — только сбросить.
 */
export type BbcEmployeeCreated = {
  employee: BbcEmployee;
  temp_password: string;
};

export type BbcRolePreset = {
  key: string;
  name: string;
  description: string;
  blocks: string[];
  data_scope: BbcDataScope;
};

/**
 * Написание из колонки «Сотрудник» вместе с тем, что за ним стоит.
 *
 * Голого имени мало: отметив человека из НО и выдав отдел ОБО, админ соберёт
 * учётку с пустым пересечением — она выглядит рабочей и не показывает ни одной
 * строки. Отделы и число клиентов видны прямо у галочки.
 */
export type BbcEmployeeAlias = {
  name: string;
  departments: string[];
  clients: number;
  rows: number;
};

export type BbcEmployeesPayload = {
  employees: BbcEmployee[];
  presets: BbcRolePreset[];
  departments: string[];
  blocks: string[];
  data_scopes: BbcDataScope[];
};

/* ── Касания ────────────────────────────────────────────────────────────────── */

export type BbcTouchFile = {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type BbcTouch = {
  id: number;
  /** Нормализованное имя клиента — тот же ключ, что и в реестре дебиторки. */
  client_key: string;
  client: string;
  author_user_id: number | null;
  /** Снимок имени автора: переживает удаление его учётки. */
  author: string;
  contacted_at: string | null;
  contact_role: string;
  contact_role_name: string;
  contact_name: string;
  channel: string;
  channel_name: string;
  summary: string;
  created_at: string | null;
  files: BbcTouchFile[];
};

export type BbcTouchForm = {
  client: string;
  contacted_at: string;
  contact_role: string;
  contact_name: string;
  channel: string;
  summary: string;
};

export type BbcTouchOptions = {
  contact_roles: { key: string; name: string }[];
  channels: { key: string; name: string }[];
  max_file_bytes: number;
  max_files: number;
};

export type BbcLink = {
  id: string;
  label: string;
  departments: string[];
  blocks: string[];
  created_at: string | null;
  /** null = permanent («публичная») link. */
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  use_count: number;
  is_active: boolean;
  /** Адрес ссылки. Приходит и при выдаче, и в списке — но только пока она жива. */
  url: string | null;
};

export type BbcOk = { ok: boolean; detail: string | null };

/* ── Data ───────────────────────────────────────────────────────────────────── */

/** Recognition modes, exactly as the backend names them. */
export type BbcMode =
  | "v2:prorata:prepay"
  | "v2:prorata:wip"
  | "v2:start:prepay"
  | "v2:start:wip"
  | "v1:period:prorata:prepay"
  | "v1:period:prorata:wip"
  | "v1:period:start:prepay"
  | "v1:period:start:wip"
  | "v1:avrdate";

/** [year, month, cycle, amount] — compact wire form of one allocation entry. */
export type BbcAllocation = [number, number, number, number];

export type BbcRecognition = {
  alloc: BbcAllocation[];
  /** Earned but not placeable yet — «на исполнении». */
  wip: number;
};

export type BbcPayment = { at: string | null; amount: number | null };

export type BbcRow = {
  /** 1-based row number in the sheet — used by the warnings block. */
  index: number;
  month: number | null;
  /** «ИЮНЬ 2026» либо «Старые (до Мая/Июня 2026)» — строка входящего остатка. */
  period_label: string;
  client: string;
  contract_no: string;
  subject: string;
  firm: string;
  firm_name: string;
  departments: string[];
  employee: string;
  service_kind: string;
  status: string;

  contract_amount: number | null;
  paid_amount: number | null;
  avr_amount: number | null;
  saldo_start: number | null;
  saldo_end: number | null;
  diff_avr_paid: number | null;

  invoiced: boolean | null;
  invoice_no: string;
  invoice_date: string | null;
  paid: boolean | null;
  payments: BbcPayment[];
  avr_signed: boolean | null;
  avr_date: string | null;
  period_start: string | null;
  period_end: string | null;
  signed_at: string | null;

  /**
   * Долг строки — колонка «Дебет / Кредит (в т.ч без АВР)».
   * Считает книга, а не мы: начальный остаток плюс суммы договоров по
   * наступившим периодам, минус оплаты.
   */
  debt: number | null;
  /** Период не наступил («Еще рано»). Это предстоящее, а не долг. */
  debt_pending: boolean;
  /** В колонке долга формульная ошибка — строка идёт в «Предупреждения». */
  debt_broken: boolean;
  /** Долг до учётных периодов. Есть только у строки «Старые…». */
  carry_in: number | null;
  /**
   * Договор вступил в силу. «Вид Услуги» = «нет» означает, что услуга ещё не
   * определена: договор зафиксирован в реестре, но платить по нему не за что.
   * Такие суммы в дебиторку не входят — их и отделы у себя не считают.
   */
  in_force: boolean;

  recognition: Record<BbcMode, BbcRecognition>;
};

export type BbcDimensions = {
  firms: string[];
  departments: string[];
  employees: string[];
  service_kinds: string[];
  statuses: string[];
  clients: string[];
  months: string[];
};

export type BbcCoverage = {
  rows: number;
  with_department: number;
  with_period_start: number;
  with_period_end: number;
  with_contract_amount: number;
  invoiced: number;
  avr_signed: number;
  paid: number;
  one_off_without_end: number;
  unassigned_rows: number;
  with_debt: number;
  debt_pending_rows: number;
  debt_broken_rows: number;
  not_in_force_rows: number;
};

export type BbcSeverity = "critical" | "important" | "info";

export type BbcWarning = {
  code: string;
  severity: BbcSeverity;
  title: string;
  /** What the anomaly does to the numbers. */
  detail: string;
  /** What to change in the source sheet. */
  hint: string;
  count: number;
  amount: number;
  rows: number[];
  truncated: boolean;
  samples: string[];
};

export type BbcWarningsSummary = {
  total: number;
  critical: number;
  important: number;
  info: number;
  rows_affected: number;
  amount_at_risk: number;
};

export type BbcPreset = { mode: BbcMode; title: string };

export type BbcSourceState = {
  fetched_at: string | null;
  row_count: number;
  error: string | null;
};

/**
 * Раскладка книги: где парсер нашёл каждую колонку.
 *
 * Колонки ищутся по названиям, поэтому вставленная в книгу колонка больше не
 * ломает чтение — она только сдвигает позиции. `drift` перечисляет то, что
 * уехало, и дашборд говорит об этом сам: «книгу поправили» должно быть видно
 * раньше, чем кто-нибудь заметит неверную цифру.
 */
export type BbcLayoutDrift = {
  key: string;
  title: string;
  was: number;
  now: number;
  header: string;
};

export type BbcLayout = {
  sheet: string;
  width: number;
  shifted: boolean;
  drift: BbcLayoutDrift[];
  /** Необязательные колонки, которых в книге нет. */
  absent: string[];
  columns: Record<string, { index: number | null; header: string; how: string }>;
};

export type BbcDataset = {
  /** Откуда взяты строки: лист Google или внутренняя книга. */
  source?: "sheets" | "books";
  /** Чем размечена книга, если строки пришли из неё. */
  source_info?: {
    table?: string;
    table_id?: string;
    rows?: number;
    covered?: number;
    missing?: string[];
  };
  revision: number;
  changed_at: string | null;
  scope: { departments: string[]; blocks: string[]; label: string };
  modes: BbcMode[];
  default_mode: BbcMode;
  presets: Record<string, BbcPreset>;
  mode_descriptions: Record<BbcMode, string>;
  rows: BbcRow[];
  dimensions: BbcDimensions;
  coverage: BbcCoverage;
  warnings: BbcWarning[];
  warnings_summary: BbcWarningsSummary;
  layout?: BbcLayout;
  sources: Record<string, BbcSourceState>;
};

/* ── Платёжный календарь ────────────────────────────────────────────────────── */

export type BbcCalendarMethod = "contract" | "statistical" | "predictive";

export type BbcLagStats = {
  sample: number;
  median: number;
  mean: number;
  p80: number;
  worst: number;
};

export type BbcExpectation = {
  row_index: number;
  client: string;
  departments: string[];
  amount: number;
  expected_at: string;
  /** Что легло в основу даты: дата счёта или начало периода. */
  anchor: "invoice" | "period";
  /** personal — по истории клиента, global — по общей статистике, plan — по договору. */
  basis: "personal" | "global" | "plan";
  days_overdue: number;
  invoiced: boolean;
};

export type BbcCalendar = {
  method: BbcCalendarMethod;
  title: string;
  hint: string;
  stats: BbcLagStats;
  clients_with_history: number;
  /** Сколько строк реально получили личный прогноз, а не откат на общий. */
  personal_rows: number;
  expectations: BbcExpectation[];
  by_day: Record<string, { amount: number; count: number; overdue: number }>;
  total: number;
  overdue_total: number;
  overdue_count: number;
  accuracy: Array<{ month: string; predicted: number; actual: number; hit_rate: number }>;
  methods: Array<{ key: BbcCalendarMethod; title: string; hint: string }>;
};

/* ── Отдел продаж ───────────────────────────────────────────────────────────── */

export type BbcPayrollLine = {
  name: string;
  role: string;
  fixed: number;
  bonus: number;
  net: number;
  taxes: number;
  total: number;
};

export type BbcSpendLine = { name: string; channel: string; plan: number; fact: number };

export type BbcChannelResult = {
  channel: string;
  spend: number;
  revenue: number;
  deals: number;
  /** Тенге выручки на тенге расхода; null, когда расхода на канал не было. */
  roi: number | null;
};

export type BbcSalesReport = {
  worksheet: string;
  revenue_plan: number;
  revenue_fact: number;
  plan_completion: number;
  per_mop: Array<{ name: string; revenue: number }>;
  payroll_plan: BbcPayrollLine[];
  payroll_fact: BbcPayrollLine[];
  contractors: BbcSpendLine[];
  ad_budget: BbcSpendLine[];
  expense_plan: number;
  expense_fact: number;
  margin_fact: number;
  channels: BbcChannelResult[];
  registry: Array<Record<string, unknown>>;
  tabs: string[];
};

/* ── Журнал ─────────────────────────────────────────────────────────────────── */

export type BbcJournalRow = {
  index: number;
  at: string | null;
  account: string;
  counterparty: string;
  firm: string;
  category: string;
  subcategory: string;
  project: string;
  contract: string;
  comment: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type BbcJournalSummary = {
  group: string;
  group_title: string;
  measure: string;
  measure_title: string;
  items: Array<{ key: string; value: number; count: number; inflow: number; outflow: number }>;
  total: number;
  rows: number;
  covered_rows: number;
  /** Доля операций, попавших в свод: для категории это около трети. */
  coverage: number;
  missing_rows: number;
  missing_value: number;
  truncated: boolean;
};

export type BbcJournalCoverage = {
  rows: number;
  with_date: number;
  with_counterparty: number;
  with_firm: number;
  with_account: number;
  with_category: number;
  with_subcategory: number;
  inflow: number;
  outflow: number;
  net: number;
};

export type BbcJournalPayload = {
  rows: BbcJournalRow[];
  coverage: BbcJournalCoverage;
  dimensions: Record<string, string[]>;
  summary: BbcJournalSummary;
  groups: Array<{ key: string; title: string }>;
  measures: Array<{ key: string; title: string }>;
};

export type BbcMsfoExport = {
  spreadsheet_id: string;
  url: string;
  sheets: string[];
  rows: number;
  exported_at: string;
};

export type BbcRevision = {
  revision: number;
  changed_at: string | null;
  rows: number;
  sources: Record<string, BbcSourceState>;
};

/* ── Legacy (kept: the raw-grid endpoints still exist) ───────────────────────── */

export type BbcStatus = {
  enabled: boolean;
  configured: boolean;
  spreadsheet_id: string | null;
  worksheet_name: string;
  credentials_available: boolean;
  detail: string | null;
};

export type BbcSheetInfo = { title: string; index: number; rows: number; cols: number };

export type BbcSnapshot = {
  worksheet: string;
  headers: string[];
  rows: string[][];
  row_count: number;
  fetched_at: string;
  metrics: Record<string, unknown>;
};
