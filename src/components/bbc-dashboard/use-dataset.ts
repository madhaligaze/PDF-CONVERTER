"use client";

/**
 * Dataset state: load once, filter instantly.
 *
 * The backend already applied the visibility scope and pre-computed the revenue
 * allocation for every mode, so this hook never re-implements accounting rules —
 * it filters rows and sums the allocation the chosen mode points at. With ~500
 * rows that is sub-millisecond, which is why filters and mode switches feel
 * instant and never hit the network.
 *
 * Filters and the four mode switches live in the URL, so any view is a shareable
 * link and survives a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BbcApiError, fetchDataset, fetchMe, type BbcSource } from "./api";
import type { BbcDataset, BbcMe, BbcMode, BbcRow } from "./types";

/** Фаза первой загрузки — что сейчас в полёте. */
export type BbcLoadPhase = "auth" | "reading" | "done";

export type Filters = {
  months: string[];
  firms: string[];
  departments: string[];
  employees: string[];
  serviceKinds: string[];
  statuses: string[];
  search: string;
};

export const EMPTY_FILTERS: Filters = {
  months: [],
  firms: [],
  departments: [],
  employees: [],
  serviceKinds: [],
  statuses: [],
  search: "",
};

/** Filter keys that hold a list of values (everything except free-text search). */
const LIST_KEYS = [
  "months",
  "firms",
  "departments",
  "employees",
  "serviceKinds",
  "statuses",
] as const;

const FALLBACK_MODE: BbcMode = "v2:prorata:wip";

/**
 * Предохранитель на кнопку «Обновить».
 *
 * Обычный поток данных Google не трогает: браузер спрашивает только `/revision`,
 * а таблицу читает фоновый цикл бэкенда. Единственная дыра — `?refresh=true`,
 * который идёт в Google напрямую и мимо всякого ограничения частоты. Человек,
 * которому кажется, что «не обновилось», нажмёт кнопку десять раз подряд и
 * выберет минутную квоту на ровном месте. Десять секунд — это меньше одного
 * фонового цикла (15 с), так что осмысленную возможность обновить руками
 * предохранитель не отнимает.
 */
const FORCE_MIN_MS = 10_000;

/* ── URL round-trip ──────────────────────────────────────────────────────────── */

function readUrl(): { filters: Filters; mode: BbcMode | null; block: string | null } {
  if (typeof window === "undefined") {
    return { filters: EMPTY_FILTERS, mode: null, block: null };
  }
  const params = new URLSearchParams(window.location.search);
  const filters: Filters = { ...EMPTY_FILTERS, search: params.get("q") ?? "" };
  for (const key of LIST_KEYS) {
    const raw = params.get(key);
    if (raw) filters[key] = raw.split(",").filter(Boolean);
  }
  return {
    filters,
    mode: (params.get("mode") as BbcMode) || null,
    block: params.get("block"),
  };
}

function writeUrl(filters: Filters, mode: BbcMode, block: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);

  for (const key of LIST_KEYS) {
    const values = filters[key];
    if (values.length) params.set(key, values.join(","));
    else params.delete(key);
  }
  if (filters.search) params.set("q", filters.search);
  else params.delete("q");
  params.set("mode", mode);
  params.set("block", block);

  const query = params.toString();
  // Состояние записи истории — не наше: в нём роутер Next держит, какую
  // страницу показывать. `null` на его месте ломал «Назад»: вышли из
  // дашборда в «Сервисы», нажали «Назад» — адрес дашборда, а на экране
  // «Сервисы», и ничего не происходит (сайт выглядел зависшим, 25.09).
  window.history.replaceState(window.history.state, "", query ? `?${query}` : window.location.pathname);
}

/* ── Filtering ───────────────────────────────────────────────────────────────── */

function matches(row: BbcRow, filters: Filters): boolean {
  if (filters.months.length && !filters.months.includes(String(row.month ?? ""))) return false;
  if (filters.firms.length && !filters.firms.includes(row.firm)) return false;
  if (filters.employees.length && !filters.employees.includes(row.employee)) return false;
  if (filters.serviceKinds.length && !filters.serviceKinds.includes(row.service_kind)) return false;
  if (filters.statuses.length && !filters.statuses.includes(row.status)) return false;
  if (filters.departments.length) {
    if (!row.departments.some((code) => filters.departments.includes(code))) return false;
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase();
    const haystack = `${row.client} ${row.contract_no} ${row.subject} ${row.employee}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/* ── Aggregation ─────────────────────────────────────────────────────────────── */

export type MonthTotals = { month: string; cycle1: number; cycle2: number; total: number };

/** Recognised revenue per calendar month, split into the two accrual cycles. */
/**
 * Все месяцы, которые встречаются хотя бы в одном варианте признания.
 *
 * Нужна как общая ось: без неё при переключении «Управленческий → Документарный»
 * месяц, где по документам ноль, просто исчезал из графика. Пропавшая колонка
 * читается как «данные потерялись», хотя ноль — это и есть ответ: акты за месяц
 * ещё не подписаны. Заодно ось перестаёт менять длину, и столбцы перетекают
 * между вариантами, а не появляются и пропадают.
 */
export function monthAxis(rows: BbcRow[]): string[] {
  const months = new Set<string>();
  for (const row of rows) {
    for (const alloc of Object.values(row.recognition)) {
      for (const [year, month] of alloc?.alloc ?? []) {
        months.add(`${year}-${String(month).padStart(2, "0")}`);
      }
    }
  }
  return [...months].sort();
}

export function byMonthCycle(rows: BbcRow[], mode: BbcMode, axis?: string[]): MonthTotals[] {
  const buckets = new Map<string, MonthTotals>();
  for (const key of axis ?? []) {
    buckets.set(key, { month: key, cycle1: 0, cycle2: 0, total: 0 });
  }
  for (const row of rows) {
    for (const [year, month, cycle, amount] of row.recognition[mode]?.alloc ?? []) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const bucket = buckets.get(key) ?? { month: key, cycle1: 0, cycle2: 0, total: 0 };
      if (cycle === 1) bucket.cycle1 += amount;
      else bucket.cycle2 += amount;
      bucket.total += amount;
      buckets.set(key, bucket);
    }
  }
  return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function recognizedTotal(rows: BbcRow[], mode: BbcMode): number {
  let total = 0;
  for (const row of rows) {
    for (const entry of row.recognition[mode]?.alloc ?? []) total += entry[3];
  }
  return total;
}

/** Money earned but not placeable yet — «на исполнении». */
export function wipTotal(rows: BbcRow[], mode: BbcMode): number {
  return rows.reduce((sum, row) => sum + (row.recognition[mode]?.wip ?? 0), 0);
}

export function sumBy(rows: BbcRow[], pick: (row: BbcRow) => number | null | undefined): number {
  return rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0);
}

/** Group rows by any dimension, keeping the group's rows for drill-down. */
export function groupBy(rows: BbcRow[], key: (row: BbcRow) => string): Map<string, BbcRow[]> {
  const groups = new Map<string, BbcRow[]>();
  for (const row of rows) {
    const value = key(row) || "—";
    const bucket = groups.get(value);
    if (bucket) bucket.push(row);
    else groups.set(value, [row]);
  }
  return groups;
}

/** True when the mode allocates V1 by act date — the gap block is meaningless then. */
export function isActDateMode(mode: BbcMode): boolean {
  return mode === "v1:avrdate";
}

/** The V1 counterpart of a V2 mode, so «Разрыв» compares like with like. */
export function documentaryCounterpart(mode: BbcMode): BbcMode {
  if (mode.startsWith("v1:")) return mode;
  return `v1:period:${mode.slice("v2:".length)}` as BbcMode;
}

/* ── Hook ────────────────────────────────────────────────────────────────────── */

export function useDataset() {
  const initial = useMemo(readUrl, []);

  const [dataset, setDataset] = useState<BbcDataset | null>(null);
  const [me, setMe] = useState<BbcMe | null>(null);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [mode, setMode] = useState<BbcMode>(initial.mode ?? FALLBACK_MODE);
  const [block, setBlock] = useState<string>(initial.block ?? "receivables");
  const [error, setError] = useState<string | null>(null);
  /**
   * Служебная строка отказа: то, что прислал сервер, или текст исключения
   * fetch. На экране она лежит под «Подробностями» и по умолчанию не видна —
   * раньше именно она и была всем сообщением об ошибке.
   */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Чем занята первая загрузка. Ровно две фазы, потому что ровно столько фронт
   * и наблюдает: `/me` в полёте и `/dataset` в полёте. Третью назвать было бы
   * враньём — всё, что происходит на бэкенде внутри одного запроса, отсюда
   * неотличимо. Экран загрузки на этом и стоит: он говорит, где именно висим.
   */
  const [phase, setPhase] = useState<BbcLoadPhase>("auth");
  const [unauthorized, setUnauthorized] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const forcedAt = useRef(0);

  /**
   * Identity first, data second.
   *
   * `/bbc/me` answers "who is asking" without ever failing, so an anonymous
   * visitor — or someone whose link was revoked — reaches the login screen
   * without a single failed request. Asking for `/dataset` first would make a
   * 401 part of the normal path, which is noise in the console and, worse,
   * indistinguishable from a real backend fault.
   */
  /**
   * Источник цифр. Живёт в состоянии, а не в адресе: это не вид данных, а то,
   * откуда они взяты, и делиться такой ссылкой — значит навязать коллеге свой
   * выбор источника, пока он смотрит на те же долги.
   */
  const [source, setSourceState] = useState<BbcSource>("sheets");
  const sourceRef = useRef<BbcSource>("sheets");

  const load = useCallback(async (refresh = false, next?: BbcSource) => {
    const chosen = next ?? sourceRef.current;
    sourceRef.current = chosen;
    setPhase("auth");
    if (refresh) {
      if (Date.now() - forcedAt.current < FORCE_MIN_MS) return;
      forcedAt.current = Date.now();
      setCooldown(Math.ceil(FORCE_MIN_MS / 1000));
    }

    try {
      const identity = await fetchMe();
      setMe(identity);

      if (!identity.authenticated) {
        setDataset(null);
        setUnauthorized(true);
        setError(null);
        return;
      }

      // Личность подтверждена — уводим экран входа СРАЗУ, не дожидаясь данных.
      // Иначе после успешного входа форма висит ещё несколько секунд, пока
      // читается таблица, кнопка возвращается в «Войти», и человек жмёт снова.
      setUnauthorized(false);
      setLoading(true);
      setPhase("reading");

      const payload = await fetchDataset(refresh, chosen);
      setDataset(payload);
      setUnauthorized(false);
      setError(null);
      setErrorDetail(null);
      // Adopt the server default only when the URL did not pin a mode.
      setMode((current) => (initial.mode ? current : payload.default_mode));
    } catch (err) {
      // A 401 here means the credential died mid-session (link revoked or
      // expired) — hand the user back to the login screen rather than an error.
      if (err instanceof BbcApiError && err.isUnauthorized) {
        setDataset(null);
        setUnauthorized(true);
        setError(null);
        setErrorDetail(null);
      } else {
        setError(err instanceof Error ? err.message : "Не удалось прочитать таблицу");
        // Показывать техническую строку только когда она добавляет что-то к
        // человеческой: у четырёхсотых они совпадают, и дублировать нечего.
        const detail = err instanceof BbcApiError ? err.detail : null;
        setErrorDetail(detail && detail !== (err as Error).message ? detail : null);
      }
    } finally {
      setLoading(false);
      setPhase("done");
    }
    // `initial.mode` is captured once on mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Вход уже вернул личность — принимаем её без повторного запроса `/me`.
   * Экран входа уходит в тот же кадр, данные догружаются под индикатором.
   */
  const adoptIdentity = useCallback(
    (identity: BbcMe) => {
      setMe(identity);
      setUnauthorized(!identity.authenticated);
      if (identity.authenticated) {
        setLoading(true);
        void load();
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    writeUrl(filters, mode, block);
  }, [filters, mode, block]);

  // Тикает только пока идёт остывание — в покое таймеров не остаётся.
  const cooling = cooldown > 0;
  useEffect(() => {
    if (!cooling) return;
    const timer = setInterval(() => {
      const left = Math.ceil((FORCE_MIN_MS - (Date.now() - forcedAt.current)) / 1000);
      setCooldown(left > 0 ? left : 0);
    }, 500);
    return () => clearInterval(timer);
  }, [cooling]);

  const rows = useMemo(
    () => (dataset ? dataset.rows.filter((row) => matches(row, filters)) : []),
    [dataset, filters],
  );

  const toggleFilter = useCallback((key: (typeof LIST_KEYS)[number], value: string) => {
    setFilters((current) => {
      const values = current[key];
      return {
        ...current,
        [key]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      };
    });
  }, []);

  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);

  const activeFilterCount = useMemo(
    () =>
      LIST_KEYS.reduce((sum, key) => sum + filters[key].length, 0) + (filters.search ? 1 : 0),
    [filters],
  );

  return {
    dataset,
    phase,
    me,
    adoptIdentity,
    rows,
    allRows: dataset?.rows ?? [],
    filters,
    setFilters,
    toggleFilter,
    clearFilters,
    activeFilterCount,
    mode,
    setMode,
    block,
    setBlock,
    loading,
    error,
    errorDetail,
    unauthorized,
    reload: load,
    source,
    /**
     * Смена источника перечитывает набор сразу: показывать долги из книги под
     * подписью «из Google» нельзя ни секунды.
     */
    setSource: (next: BbcSource) => {
      setSourceState(next);
      void load(false, next);
    },
    /** Секунд до следующего разрешённого ручного обновления, 0 — можно. */
    refreshCooldown: cooldown,
  };
}
