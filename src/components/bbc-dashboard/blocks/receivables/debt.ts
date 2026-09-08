/**
 * Строки книги → реестр клиентов.
 *
 * Долг каждой строки уже посчитан на бэкенде (`debt` + `carry_in`): книга сама
 * решает, наступил ли период, а мы её не пересчитываем — иначе цифра на экране
 * разойдётся с той, по которой живёт отдел. Здесь только группировка.
 *
 * Функции чистые и без React: их можно проверить тестом, не поднимая страницу.
 */
import type { BbcRow } from "../../types";

const DAY = 86_400_000;

export type ContractDebt = {
  key: string;
  contractNo: string;
  subject: string;
  employee: string;
  firm: string;
  firmName: string;
  departments: string[];
  /** Долг вместе с входящим остатком. */
  debt: number;
  /** Периоды, срок которых ещё не пришёл. Это не долг. */
  pending: number;
  /** Договоры, не вступившие в силу. Тоже не долг, но по другой причине. */
  parked: number;
  /** Дней с начала самого старого неоплаченного периода. */
  ageDays: number | null;
  broken: boolean;
  rows: BbcRow[];
};

export type ClientDebt = {
  key: string;
  client: string;
  debt: number;
  pending: number;
  parked: number;
  ageDays: number | null;
  departments: string[];
  contracts: ContractDebt[];
  broken: boolean;
  rows: BbcRow[];
};

/**
 * Долг строки. У договора, не вступившего в силу, долга нет: сумма
 * зафиксирована, но платить по ней пока не за что — см. `rowParked`.
 */
export function rowDebt(row: BbcRow): number {
  if (!row.in_force) return 0;
  return (row.debt ?? 0) + (row.carry_in ?? 0);
}

/** Сумма подвешенного договора — не долг, но и не ноль. */
export function rowParked(row: BbcRow): number {
  if (row.in_force) return 0;
  return (row.debt ?? 0) + (row.carry_in ?? 0);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  return Math.floor((Date.now() - time) / DAY);
}

/**
 * Возраст долга — дней с начала самого раннего периода, который до сих пор
 * не закрыт. Считается по периоду, а не по дате счёта: долг возникает, когда
 * период начался, и счёт может быть выставлен позже или не выставлен вовсе.
 */
function ageOf(rows: BbcRow[]): number | null {
  const ages = rows
    .filter((row) => rowDebt(row) > 0)
    .map((row) => daysSince(row.period_start ?? row.invoice_date))
    .filter((age): age is number => age !== null && age > 0);
  return ages.length ? Math.max(...ages) : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function parkedOf(rows: BbcRow[]): number {
  return rows.reduce((sum, row) => sum + rowParked(row), 0);
}

function pendingOf(rows: BbcRow[]): number {
  return rows
    .filter((row) => row.debt_pending && row.in_force)
    .reduce((sum, row) => sum + (row.contract_amount ?? 0), 0);
}

function groupInto<T>(rows: BbcRow[], key: (row: BbcRow) => string): Map<string, BbcRow[]> {
  const groups = new Map<string, BbcRow[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = groups.get(id);
    if (bucket) bucket.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

function buildContract(key: string, rows: BbcRow[]): ContractDebt {
  const head = rows[0];
  return {
    key,
    contractNo: head.contract_no,
    subject: head.subject,
    employee: head.employee,
    firm: head.firm,
    firmName: head.firm_name,
    departments: unique(rows.flatMap((row) => row.departments)),
    debt: rows.reduce((sum, row) => sum + rowDebt(row), 0),
    pending: pendingOf(rows),
    parked: parkedOf(rows),
    ageDays: ageOf(rows),
    broken: rows.some((row) => row.debt_broken),
    rows,
  };
}

/**
 * Ключ клиента.
 *
 * В книге один и тот же заказчик пишется по-разному: «ТОО "АТРИУМ ПЛЮС"» и
 * «ТОО "Атриум плюс"», «ИП AgroLine KZ» и «ИП Agroline KZ». Без сведения
 * регистра клиент разваливается в реестре на две строки с половиной долга
 * каждая — а во вкладке отдела он один, и сверка это подтвердила.
 */
export function clientKey(name: string): string {
  // Тот же ключ считает бэкенд в `touches.client_key`. Разойтись им нельзя:
  // касание, записанное из реестра, не нашлось бы в журнале по тому же клиенту.
  return name.trim().split(/\s+/).join(" ").toLowerCase();
}

/** Из нескольких написаний берём самое частое; при равенстве — первое по алфавиту. */
function preferredSpelling(rows: BbcRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.client, (counts.get(row.client) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"),
  )[0][0];
}

/**
 * Реестр клиентов, по убыванию долга.
 *
 * Клиенты без долга остаются в списке — «ноль» это ответ, а исчезнувшая строка
 * читается как потерянные данные. Они уходят в конец.
 */
export function buildRegistry(rows: BbcRow[]): ClientDebt[] {
  const withClient = rows.filter((row) => row.client);

  const clients = [...groupInto(withClient, (row) => clientKey(row.client)).entries()].map(
    ([key, clientRows]) => {
      const client = preferredSpelling(clientRows);
      const contracts = [...groupInto(clientRows, (row) => row.contract_no || "—").entries()]
        .map(([contractNo, contractRows]) => buildContract(`${key}·${contractNo}`, contractRows))
        .sort((a, b) => b.debt - a.debt);

      return {
        key,
        client,
        debt: clientRows.reduce((sum, row) => sum + rowDebt(row), 0),
        pending: pendingOf(clientRows),
        parked: parkedOf(clientRows),
        ageDays: ageOf(clientRows),
        departments: unique(clientRows.flatMap((row) => row.departments)),
        contracts,
        broken: clientRows.some((row) => row.debt_broken),
        rows: clientRows,
      };
    },
  );

  return clients.sort((a, b) => b.debt - a.debt || a.client.localeCompare(b.client, "ru"));
}

/** Итоги реестра — то, что стоит в шапке над таблицей. */
export function registryTotals(clients: ClientDebt[]) {
  return {
    clients: clients.length,
    debtors: clients.filter((client) => client.debt > 0).length,
    debt: clients.reduce((sum, client) => sum + client.debt, 0),
    pending: clients.reduce((sum, client) => sum + client.pending, 0),
    parked: clients.reduce((sum, client) => sum + client.parked, 0),
    broken: clients.filter((client) => client.broken).length,
  };
}

/**
 * Долг всех строк — ровно один раз на строку.
 *
 * Существует отдельно от `debtByDepartment` именно потому, что складывать её
 * карту нельзя: строка «ОБО, НО, ЮО, HR» лежит в четырёх отделах и в сумме
 * карты посчиталась бы четырежды. Так и было на кнопке «Вся компания» — она
 * показывала число больше, чем шапка над той же таблицей, и понять, какому
 * верить, было нельзя.
 */
export function totalDebt(rows: BbcRow[]): number {
  return rows.reduce((sum, row) => sum + rowDebt(row), 0);
}

/**
 * Разбивка долга по отделам — строка может числиться за несколькими сразу.
 *
 * Двойной учёт здесь намеренный и честный: «сколько долга числится за ОБО» —
 * это вопрос про ОБО, и общая с НО строка входит в ответ целиком. Но сумма
 * значений этой карты — не «долг компании», а число без смысла. Для итога есть
 * `totalDebt`.
 */
export function debtByDepartment(rows: BbcRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const debt = rowDebt(row);
    if (!debt) continue;
    const departments = row.departments.length ? row.departments : ["—"];
    for (const department of departments) {
      totals.set(department, (totals.get(department) ?? 0) + debt);
    }
  }
  return totals;
}
