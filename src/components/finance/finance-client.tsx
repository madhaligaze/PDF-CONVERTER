"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ArrowLeftIcon, CloseIcon, RefreshIcon, TableIcon } from "@/components/icons";
import {
  type Dictionaries,
  type Overview,
  financeApi,
  formatMoney,
} from "@/components/finance/api";
import { OperationDialog } from "@/components/finance/operation-dialog";
import { Journal } from "@/components/finance/journal";
import { ImportPanel } from "@/components/finance/import-panel";
import { CashFlowReport, DebtsReport, ProfitReport, ProjectsReport } from "@/components/finance/reports";
import { CalendarView } from "@/components/finance/calendar-view";
import { PlanActualReport } from "@/components/finance/plan-actual";
import { DictionariesPanel } from "@/components/finance/dictionaries-panel";

/**
 * Табличный вид грузится только по требованию: Univer тянет за собой канвас и
 * при импорте обращается к `window`, поэтому серверная отрисовка его роняет
 * («Path2D is not defined»). Тот же приём, что в «Книгах» и «Таблицах».
 */
const TableView = dynamic(() => import("./table-view").then((m) => m.TableView), {
  ssr: false,
  loading: () => <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>Готовим лист…</div>,
});

type Section =
  | "journal"
  | "table"
  | "calendar"
  | "cash"
  | "profit"
  | "debts"
  | "projects"
  | "plan"
  | "import"
  | "dictionaries";

const SECTIONS: { key: Section; title: string }[] = [
  { key: "journal", title: "Журнал" },
  { key: "table", title: "Таблица" },
  { key: "calendar", title: "Календарь" },
  { key: "cash", title: "Деньги" },
  { key: "profit", title: "Прибыль" },
  { key: "debts", title: "Долги" },
  { key: "projects", title: "Проекты" },
  { key: "plan", title: "План / Факт" },
  { key: "import", title: "Загрузка файла" },
  { key: "dictionaries", title: "Справочники" },
];

export function FinanceClient() {
  const [section, setSection] = useState<Section>("journal");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [error, setError] = useState<string>("");
  const [dialogKind, setDialogKind] = useState<"income" | "expense" | "transfer" | null>(null);
  /**
   * Счётчик перезагрузок. Меняется, когда данные изменились где угодно в
   * разделе, и по нему обновляются и сводка слева, и открытый экран.
   *
   * Счётчик, а не флаг: два изменения подряд с флагом дали бы одну
   * перезагрузку, и вторая правка осталась бы не видна — та же ошибка, что
   * ловили в «Книгах» на быстром наборе.
   */
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [next, dicts] = await Promise.all([financeApi.overview(), financeApi.dictionaries()]);
        if (!alive) return;
        setOverview(next);
        setDictionaries(dicts);
        setError("");
      } catch (exc) {
        if (!alive) return;
        setError(exc instanceof Error ? exc.message : "Не удалось прочитать данные раздела");
      }
    })();
    return () => {
      alive = false;
    };
  }, [revision]);

  const currency = overview?.workspace.currency ?? "KZT";
  const symbol = currency === "KZT" ? "₸" : currency;

  const content = useMemo(() => {
    if (!dictionaries) return null;
    switch (section) {
      case "journal":
        return <Journal dictionaries={dictionaries} revision={revision} onChanged={reload} />;
      case "table":
        return <TableView onChanged={reload} />;
      case "calendar":
        return <CalendarView revision={revision} />;
      case "cash":
        return <CashFlowReport revision={revision} />;
      case "profit":
        return <ProfitReport revision={revision} />;
      case "debts":
        return <DebtsReport revision={revision} onChanged={reload} />;
      case "projects":
        return <ProjectsReport revision={revision} />;
      case "plan":
        return <PlanActualReport revision={revision} onChanged={reload} />;
      case "import":
        return <ImportPanel onChanged={reload} accounts={dictionaries.accounts} />;
      case "dictionaries":
        return <DictionariesPanel dictionaries={dictionaries} onChanged={reload} />;
      default:
        return null;
    }
  }, [section, dictionaries, revision, reload]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col" style={{ background: "var(--page-bg)" }}>
      <header
        className="fin-head sticky top-0 z-40 flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b backdrop-blur-md"
        style={{ background: "var(--header-bg)", borderColor: "var(--border-subtle)" }}
      >
        <Link href="/services" className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5" title="К сервисам">
          <ArrowLeftIcon size={15} />
          <span className="only-desktop">Сервисы</span>
        </Link>
        <span className="logo-badge">
          <TableIcon size={16} />
        </span>
        <span
          className="text-sm font-semibold mr-auto"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        >
          Финансы
        </span>

        <div className="fin-actions">
          <button type="button" className="fin-act" data-kind="income" onClick={() => setDialogKind("income")}>
            + Доход
          </button>
          <button type="button" className="fin-act" data-kind="expense" onClick={() => setDialogKind("expense")}>
            − Расход
          </button>
          {/* «Перевод» на телефоне не прячется: перевод из кассы на счёт —
              обычная работа кассира. В одну строку с двумя другими кнопками он
              не влезал, поэтому на узком экране вся тройка переносится на свою
              строку (см. `.fin-head` в globals.css). */}
          <button type="button" className="fin-act" onClick={() => setDialogKind("transfer")}>
            ⇄ Перевод
          </button>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs px-2 py-1.5 only-desktop"
          onClick={reload}
          title="Перечитать данные"
        >
          <RefreshIcon size={15} />
        </button>
      </header>

      {error ? (
        <div
          className="mx-3 sm:mx-4 mt-3 px-3 py-2 text-xs card-inner flex items-start gap-2"
          style={{ borderColor: "var(--outflow-border)", background: "var(--outflow-bg)", color: "var(--text-primary)" }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Скрыть сообщение">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      <div className="fin-shell flex-1">
        <aside className="fin-aside">
          <div className="fin-total">
            <span className="eyebrow">Всего на счетах</span>
            <span className="fin-total-value">
              {symbol} {overview ? formatMoney(overview.total) : "—"}
            </span>
            {overview && overview.total_with_plan !== overview.total ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {symbol} {formatMoney(overview.total_with_plan)} с учётом ожиданий
              </span>
            ) : null}
          </div>

          <div>
            <p className="eyebrow mb-1">Счета</p>
            {(overview?.accounts ?? []).map((account) => (
              <div key={account.id} className="fin-acc-row">
                <span className="fin-acc-name" title={account.name}>
                  {account.name}
                  {account.excluded_from_reports ? " · вне отчётов" : ""}
                </span>
                <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(account.balance)}
                </span>
              </div>
            ))}
            {overview && overview.accounts.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Счетов пока нет — завести их можно в «Справочниках».
              </p>
            ) : null}
          </div>

          <div>
            <p className="eyebrow mb-1">Ожидания</p>
            <div className="fin-acc-row">
              <span className="fin-acc-name">Нам должны</span>
              <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                {overview ? formatMoney(overview.receivable) : "—"}
              </span>
            </div>
            <div className="fin-acc-row">
              <span className="fin-acc-name">Мы должны</span>
              <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                {overview ? formatMoney(overview.payable) : "—"}
              </span>
            </div>
            {overview && Number(overview.overdue_receivable) > 0 ? (
              // Просрочка — единственная цифра в панели, которой положен цвет:
              // это не состояние «идёт как идёт», а срок, который прошёл.
              <div className="fin-acc-row">
                <span className="fin-acc-name">Срок прошёл</span>
                <span className="fin-num fin-out">{formatMoney(overview.overdue_receivable)}</span>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="min-w-0 px-3 sm:px-4 pb-10">
          <nav className="fin-tabs" aria-label="Разделы финансов">
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="fin-tab"
                data-on={section === item.key}
                onClick={() => setSection(item.key)}
              >
                {item.title}
              </button>
            ))}
          </nav>
          {content}
        </main>
      </div>

      {dialogKind && dictionaries ? (
        <OperationDialog
          kind={dialogKind}
          dictionaries={dictionaries}
          onClose={() => setDialogKind(null)}
          onSaved={() => {
            setDialogKind(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
