"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import {
  ArrowLeftIcon,
  BookIcon,
  BoltIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  FolderIcon,
  GridIcon,
  ListIcon,
  PeopleIcon,
  RefreshIcon,
  TableIcon,
  TargetIcon,
  TrendIcon,
  UploadIcon,
  WalletIcon,
} from "@/components/icons";
import {
  type Dictionaries,
  type Me,
  type Overview,
  financeApi,
  compactMoney,
  formatMoney,
} from "@/components/finance/api";
import { AuthGate, AuthLoading, PasswordChangeGate, useMe } from "@/components/finance/auth-gate";
import { TeamPanel } from "@/components/finance/team-panel";
import { RulesPanel } from "@/components/finance/rules-panel";
import { OperationDialog } from "@/components/finance/operation-dialog";
import { Journal } from "@/components/finance/journal";
import { ImportPanel } from "@/components/finance/import-panel";
import { SheetsPanel } from "@/components/finance/sheets-panel";
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
  | "sheets"
  | "dictionaries"
  | "rules"
  | "team";

/**
 * Разделы живут в левой колонке, а не лентой сверху.
 *
 * Лента из тринадцати названий не помещалась даже на 1440: последняя вкладка
 * обрезалась, и о её существовании узнавали случайно. В колонке место есть
 * всегда, а свёрнутая она занимает ширину пальца — ровно то устройство, что у
 * Finmap, и по той же причине.
 *
 * Значок здесь не украшение: в свёрнутой колонке он единственное, по чему
 * раздел узнаётся.
 */
const SECTIONS: { key: Section; title: string; icon: (props: { size?: number }) => ReactElement }[] = [
  { key: "journal", title: "Журнал", icon: ListIcon },
  { key: "table", title: "Таблица", icon: TableIcon },
  { key: "calendar", title: "Календарь", icon: CalendarIcon },
  { key: "cash", title: "Деньги", icon: WalletIcon },
  { key: "profit", title: "Прибыль", icon: TrendIcon },
  { key: "debts", title: "Долги", icon: ClockIcon },
  { key: "projects", title: "Проекты", icon: FolderIcon },
  { key: "plan", title: "План / Факт", icon: TargetIcon },
  { key: "import", title: "Загрузка", icon: UploadIcon },
  { key: "sheets", title: "Google Таблицы", icon: GridIcon },
  { key: "rules", title: "Правила", icon: BoltIcon },
  { key: "dictionaries", title: "Справочники", icon: BookIcon },
  { key: "team", title: "Команда", icon: PeopleIcon },
];

export function FinanceClient() {
  // Раздел сам решает, кто вошёл: своя учётка, свой вход, своя компания.
  const { me, setMe, loading } = useMe();
  const [section, setSection] = useState<Section>("journal");
  /**
   * Колонка разделов: свёрнута в полосу значков и раскрывается наведением.
   *
   * Закрепить её открытой можно кнопкой — тогда она не сворачивается, когда
   * курсор уходит. Свёрнутое состояние по умолчанию работает только потому,
   * что полоса теперь видима: подложка, значки разделов и текущий раздел
   * плашкой. В прежнем виде — 60px пустоты с вертикальной цифрой — её
   * принимали за край экрана и не наводили на неё курсор вообще.
   */
  const [railOpen, setRailOpen] = useState(false);
  useEffect(() => {
    try {
      setRailOpen(localStorage.getItem("fin_rail") === "pinned");
    } catch {
      /* приватное окно — панель просто останется свёрнутой */
    }
  }, []);
  const toggleRail = useCallback(() => {
    setRailOpen((was) => {
      const next = !was;
      try {
        localStorage.setItem("fin_rail", next ? "pinned" : "hover");
      } catch {
        /* не запомнилось — не беда */
      }
      return next;
    });
  }, []);
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

  const companyId = me?.company?.id ?? null;

  useEffect(() => {
    if (!companyId) return;
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
    // Компания в зависимостях не для порядка: при переключении надо перечитать
    // всё, иначе на экране останутся счета и операции прежней компании.
  }, [revision, companyId]);

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
      case "sheets":
        return <SheetsPanel onChanged={reload} accounts={dictionaries.accounts} />;
      case "rules":
        return <RulesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "dictionaries":
        return <DictionariesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "team":
        return me ? <TeamPanel me={me} onChanged={reload} /> : null;
      default:
        return null;
    }
  }, [section, dictionaries, revision, reload, me]);

  if (loading) return <AuthLoading />;
  if (!me) return <AuthGate onReady={(next) => setMe(next)} />;
  if (me.user?.must_change_password) {
    return (
      <PasswordChangeGate
        onDone={async () => {
          const next = await financeApi.me();
          setMe(next.authenticated ? next : null);
        }}
      />
    );
  }

  return (
    <div className="fin-page">
      <header className="fin-head">
        <Link
          href="/services"
          className="fin-act only-desktop"
          style={{ padding: "0 0.75rem" }}
          title="К сервисам"
        >
          <ArrowLeftIcon size={15} />
        </Link>
        <span className="logo-badge">
          <TableIcon size={16} />
        </span>
        {/* Компания в шапке, а не название раздела: человек ведёт несколько
            компаний, и первое, что ему надо знать, — в какой он сейчас. */}
        <div className="flex flex-col mr-auto min-w-0">
          <span
            className="fin-head-title text-sm font-semibold truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {me.company?.title ?? "Финансы"}
          </span>
          {(me.companies?.length ?? 0) > 1 ? (
            <select
              className="fin-head-sub text-xs bg-transparent cursor-pointer"
              style={{ border: "none", outline: "none", padding: 0 }}
              value={me.company?.id ?? ""}
              onChange={async (event) => {
                const next = await financeApi.switchCompany(event.target.value);
                setMe(next);
                reload();
              }}
              aria-label="Сменить компанию"
            >
              {(me.companies ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.title}
                </option>
              ))}
            </select>
          ) : (
            <span className="fin-head-sub text-xs">Финансы</span>
          )}
        </div>

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
          className="fin-act only-desktop"
          style={{ padding: "0 0.75rem" }}
          onClick={reload}
          title="Перечитать данные"
        >
          <RefreshIcon size={15} />
        </button>
        <button
          type="button"
          className="fin-act only-desktop"
          onClick={async () => {
            await financeApi.logout();
            setMe(null);
          }}
          title={me.user?.email ?? ""}
        >
          Выйти
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

      <div className="fin-plate">
        <aside className="fin-aside" data-open={railOpen ? "true" : undefined}>
          {/* Навигация. В свёрнутой колонке видны значки, в раскрытой — названия.
              Подпись не прячется display'ем: свёрнутая колонка её обрезает
              шириной, поэтому переход плавный, а не мигающий. */}
          <nav className="fin-nav" aria-label="Разделы финансов">
            {SECTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="fin-nav-item"
                data-on={section === item.key}
                title={item.title}
                onClick={() => setSection(item.key)}
              >
                <span className="fin-nav-ico">
                  <item.icon size={17} />
                </span>
                <span className="fin-nav-text">{item.title}</span>
              </button>
            ))}
          </nav>

          {/* Главная цифра в свёрнутом виде: ради неё на панель и смотрят, не
              раскрывая её. В раскрытой колонке её место занимает полный блок. */}
          <div className="fin-rail-foot" aria-hidden="true">
            <span className="fin-rail-sum">{compactMoney(overview?.total)}</span>
            <span className="fin-rail-cur">{symbol}</span>
          </div>


          <div className="fin-aside-full flex flex-col gap-3">
          <div className="fin-total">
            <span className="fin-total-label">Всего на счетах</span>
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
            <p className="fin-label mb-1">Счета</p>
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
                Счетов пока нет
              </p>
            ) : null}
          </div>

          <div>
            <p className="fin-label mb-1">Ожидания</p>
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
          </div>

          <button
            type="button"
            className="fin-rail-toggle"
            onClick={toggleRail}
            aria-label={railOpen ? "Открепить панель" : "Закрепить панель открытой"}
            title={railOpen ? "Открепить — будет раскрываться наведением" : "Закрепить открытой"}
          >
            <span className="fin-rail-toggle-ico">
              <ChevronRightIcon size={14} />
            </span>
            <span className="fin-nav-text">{railOpen ? "Открепить" : "Закрепить"}</span>
          </button>
        </aside>

        <main className="fin-body min-w-0">
          {/* На телефоне колонка не работает — там разделы остаются лентой. */}
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
