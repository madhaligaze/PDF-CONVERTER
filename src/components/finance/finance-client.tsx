"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import {
  ArrowLeftIcon,
  BookIcon,
  BoltIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  ContractGridIcon,
  ContractIcon,
  FileTextIcon,
  FolderIcon,
  GaugeIcon,
  GridIcon,
  HistoryIcon,
  PlugIcon,
  ReceiptIcon,
  RepeatIcon,
  ScaleIcon,
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
  type Overview,
  financeApi,
  compactMoney,
  formatMoney,
} from "@/components/finance/api";
import { AuthGate, AuthLoading, PasswordChangeGate, useMe } from "@/components/finance/auth-gate";
import { FadeIn } from "@/components/motion/fade-in";
import { SplitReveal } from "@/components/motion/split-reveal";
import { StageLink } from "@/components/motion/stage-transition";
import { TeamPanel } from "@/components/finance/team-panel";
import { RulesPanel } from "@/components/finance/rules-panel";
import { OperationDialog } from "@/components/finance/operation-dialog";
import { Journal } from "@/components/finance/journal";
import { ImportPanel } from "@/components/finance/import-panel";
import { SheetsPanel } from "@/components/finance/sheets-panel";
import { FinanceServiceIcon } from "@/components/service-icons";
import { InvoicesPanel } from "@/components/finance/invoices-panel";
import { RecurrencesPanel } from "@/components/finance/recurrences-panel";
import { IntegrationsPanel } from "@/components/finance/integrations-panel";
import {
  BalanceReport,
  HistoryPanel,
  IndicatorsReport,
  StatementReport,
} from "@/components/finance/ledger-reports";
import { CashFlowReport, DebtsReport, ProfitReport, ProjectsReport } from "@/components/finance/reports";
import { CalendarView } from "@/components/finance/calendar-view";
import { PlanActualReport } from "@/components/finance/plan-actual";
import { DictionariesPanel } from "@/components/finance/dictionaries-panel";
import { Registry } from "@/components/finance/contracts/registry-cards";
import { readParam, writeParams } from "@/components/finance/address";

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
  | "contracts"
  | "contracts-sheet"
  | "contracts-import"
  | "contracts-setup"
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
  | "team"
  | "invoices"
  | "recurrences"
  | "integrations"
  | "balance"
  | "indicators"
  | "statement"
  | "history";

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
type SectionItem = { key: Section; title: string; icon: (props: { size?: number }) => ReactElement };

/**
 * Разделы сгруппированы так же, как у Finmap: работа с операциями, отчёты,
 * настройки. Двадцать пунктов подряд — это уже поиск, а не навигация; три
 * группы по шесть-восемь читаются одним взглядом.
 */
const GROUPS: { title: string; items: SectionItem[] }[] = [
  {
    // Договоры — первыми: колонка идёт в порядке цепочки учёта, от договора к
    // деньгам и отчётам (план, «Картина целиком»).
    title: "Договоры",
    items: [
      { key: "contracts", title: "Реестр", icon: ContractIcon },
      { key: "contracts-sheet", title: "Реестр · таблица", icon: ContractGridIcon },
    ],
  },
  {
    title: "Учёт",
    items: [
      { key: "journal", title: "Журнал", icon: ListIcon },
      { key: "table", title: "Таблица", icon: TableIcon },
      { key: "calendar", title: "Календарь", icon: CalendarIcon },
      { key: "invoices", title: "Счета", icon: ReceiptIcon },
      { key: "recurrences", title: "Повторения", icon: RepeatIcon },
      { key: "import", title: "Загрузка", icon: UploadIcon },
      { key: "sheets", title: "Google Таблицы", icon: GridIcon },
    ],
  },
  {
    title: "Отчёты",
    items: [
      { key: "cash", title: "Деньги", icon: WalletIcon },
      { key: "profit", title: "Прибыль", icon: TrendIcon },
      { key: "debts", title: "Долги", icon: ClockIcon },
      { key: "balance", title: "Баланс", icon: ScaleIcon },
      { key: "indicators", title: "Показатели", icon: GaugeIcon },
      { key: "statement", title: "Выписка по счёту", icon: FileTextIcon },
      { key: "projects", title: "Проекты", icon: FolderIcon },
      { key: "plan", title: "План / Факт", icon: TargetIcon },
    ],
  },
  {
    title: "Настройки",
    items: [
      { key: "integrations", title: "Интеграции", icon: PlugIcon },
      { key: "rules", title: "Правила", icon: BoltIcon },
      { key: "dictionaries", title: "Справочники", icon: BookIcon },
      { key: "team", title: "Команда", icon: PeopleIcon },
      { key: "history", title: "История", icon: HistoryIcon },
    ],
  },
];

/** Экраны без пункта в колонке: редкие действия внутри «Реестра» (меню ⋯). */
const HIDDEN_SECTIONS: SectionItem[] = [
  { key: "contracts-import", title: "Загрузка реестра", icon: UploadIcon },
  { key: "contracts-setup", title: "Настроить реестр", icon: BookIcon },
];

const SECTIONS: SectionItem[] = GROUPS.flatMap((group) => group.items);
const ALL_SECTIONS: SectionItem[] = [...SECTIONS, ...HIDDEN_SECTIONS];

function sectionFromAddress(): Section {
  const wanted = readParam("s");
  return (ALL_SECTIONS.find((item) => item.key === wanted)?.key as Section | undefined) ?? "journal";
}

/**
 * Закреплена ли колонка разделов — выбор человека, переживающий перезагрузку.
 *
 * Через `useSyncExternalStore`, а не «прочитать в эффекте и положить в
 * состояние»: второй способ сначала рисует свёрнутую колонку, потом раскрытую,
 * и закреплённая панель мигает при каждом открытии раздела. Если хранилище
 * недоступно (приватное окно), выбор живёт в памяти до перезагрузки.
 */
const RAIL_KEY = "fin_rail";
let railMemory = false;
const railListeners = new Set<() => void>();

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "pinned";
  } catch {
    return railMemory;
  }
}

function writeRail(pinned: boolean): void {
  railMemory = pinned;
  try {
    localStorage.setItem(RAIL_KEY, pinned ? "pinned" : "hover");
  } catch {
    /* выбор останется в памяти */
  }
  railListeners.forEach((listener) => listener());
}

function subscribeRail(listener: () => void): () => void {
  railListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    railListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function FinanceClient() {
  // Раздел сам решает, кто вошёл: своя учётка, свой вход, своя компания.
  const { me, setMe, loading } = useMe();
  const [section, setSectionState] = useState<Section>("journal");
  /**
   * Раздел живёт в адресе: ссылку на реестр или договор можно переслать.
   * Первый раздел читается после монтирования, а не в начальном состоянии —
   * иначе серверная отрисовка и первая клиентская разошлись бы.
   */
  useEffect(() => {
    setSectionState(sectionFromAddress());
    const onPop = () => setSectionState(sectionFromAddress());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const setSection = useCallback((next: Section | string) => {
    const key = (ALL_SECTIONS.find((item) => item.key === next)?.key ?? "journal") as Section;
    setSectionState(key);
    // Запись открытого договора и лист принадлежат реестру — при смене
    // раздела они уходят из адреса.
    writeParams({ s: key === "journal" ? null : key, id: null, v: null }, true);
  }, []);
  /**
   * Колонка разделов: свёрнута в полосу значков и раскрывается наведением.
   *
   * Закрепить её открытой можно кнопкой — тогда она не сворачивается, когда
   * курсор уходит. Свёрнутое состояние по умолчанию работает только потому,
   * что полоса теперь видима: подложка, значки разделов и текущий раздел
   * плашкой. В прежнем виде — 60px пустоты с вертикальной цифрой — её
   * принимали за край экрана и не наводили на неё курсор вообще.
   */
  const railOpen = useSyncExternalStore(subscribeRail, readRail, () => false);

  /**
   * Новый раздел открывается с начала.
   *
   * Иначе прокрутка оставалась там, где был прошлый раздел: пункт «Правила»
   * внизу колонки нажимали, прокрутив страницу, и новый раздел рисовался выше
   * экрана — человек видел пустоту и листал наверх сам. Первое открытие
   * пропускается: страница и так в начале, а прыжок при загрузке мешал бы
   * якорю в адресе, если он когда-нибудь появится.
   */
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [section]);
  const toggleRail = useCallback(() => writeRail(!readRail()), []);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [error, setError] = useState<string>("");
  const [dialogKind, setDialogKind] = useState<"income" | "expense" | "transfer" | null>(null);
  /** Карточка открывается с уже отмеченным ожиданием — из раздела «Долги». */
  const [dialogPlan, setDialogPlan] = useState(false);
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
  /**
   * Пересобрать лист «Таблицы» — только по кнопке «Перечитать».
   *
   * Отдельно от `revision`, потому что лист сам зовёт `reload` после каждой
   * правки, чтобы обновились остатки слева. Пересобирай он себя на каждый
   * такой вызов — прыгал бы в начало после каждой ячейки, а строки меняли бы
   * порядок прямо под курсором.
   */
  const [sheetRefresh, setSheetRefresh] = useState(0);

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
      case "contracts":
        return me ? <Registry me={me} onGo={setSection} /> : null;
      case "contracts-sheet":
      case "contracts-import":
      case "contracts-setup":
        return <p className="creg-empty">Экран собирается — будет в этой сборке.</p>;
      case "journal":
        return <Journal dictionaries={dictionaries} revision={revision} onChanged={reload} />;
      case "table":
        return <TableView onChanged={reload} refresh={sheetRefresh} />;
      case "calendar":
        return <CalendarView revision={revision} />;
      case "cash":
        return <CashFlowReport revision={revision} />;
      case "profit":
        return <ProfitReport revision={revision} />;
      case "debts":
        return <DebtsReport
            revision={revision}
            onChanged={reload}
            onNewExpectation={(kind) => {
              setDialogPlan(true);
              setDialogKind(kind);
            }}
          />;
      case "projects":
        return <ProjectsReport revision={revision} />;
      case "plan":
        return <PlanActualReport revision={revision} onChanged={reload} />;
      case "import":
        return <ImportPanel onChanged={reload} accounts={dictionaries.accounts} onNext={() => setSection("rules")} />;
      case "sheets":
        return <SheetsPanel onChanged={reload} accounts={dictionaries.accounts} />;
      case "rules":
        return <RulesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "dictionaries":
        return <DictionariesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "team":
        return me ? <TeamPanel me={me} onChanged={reload} /> : null;
      case "invoices":
        return <InvoicesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "recurrences":
        return <RecurrencesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "integrations":
        return <IntegrationsPanel accounts={dictionaries.accounts} onGo={setSection} onChanged={reload} />;
      case "balance":
        return <BalanceReport revision={revision} />;
      case "indicators":
        return <IndicatorsReport revision={revision} />;
      case "statement":
        return <StatementReport accounts={dictionaries.accounts} revision={revision} />;
      case "history":
        return <HistoryPanel revision={revision} onChanged={reload} />;
      default:
        return null;
    }
  }, [section, dictionaries, revision, reload, me, sheetRefresh, setSection]);

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
        <StageLink
          href="/services"
          label="Сервисы"
          className="fin-act only-desktop"
          style={{ padding: "0 0.75rem" }}
          title="К сервисам"
        >
          <ArrowLeftIcon size={15} />
        </StageLink>
        <span className="fin-brand">
          <FinanceServiceIcon size={18} />
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
          <button type="button" className="fin-act" data-kind="income" onClick={() => {
              setDialogPlan(false);
              setDialogKind("income");
            }}>
            + Доход
          </button>
          <button type="button" className="fin-act" data-kind="expense" onClick={() => {
              setDialogPlan(false);
              setDialogKind("expense");
            }}>
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
          onClick={() => {
            reload();
            setSheetRefresh((value) => value + 1);
          }}
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
          {/* Внутренний слой прилипает к экрану, а сама колонка тянется на
              всю высоту плиты — вместе с подложкой и разделительной линией.
              Прилипни колонка целиком, подложка обрывалась бы посреди длинного
              журнала. */}
          <div className="fin-aside-inner">
          {/* Навигация. В свёрнутой колонке видны значки, в раскрытой — названия.
              Подпись не прячется display'ем: свёрнутая колонка её обрезает
              шириной, поэтому переход плавный, а не мигающий. */}
          <nav className="fin-nav" aria-label="Разделы финансов">
            {GROUPS.map((group) => (
              <div key={group.title} className="fin-nav-group">
                <span className="fin-nav-head">{group.title}</span>
                {group.items.map((item) => (
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
              </div>
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
          </div>
        </aside>

        <main className="fin-body min-w-0">
          {/* Заголовок раздела. Пока разделы были лентой вкладок, лента и была
              верхом страницы; когда она ушла в колонку, содержимое упёрлось в
              край плиты, и страница читалась обрезанной. */}
          {/* Смена раздела: заголовок поднимается буквами, содержимое
              проявляется. key обязателен у обоих — SplitText переписывает DOM
              надписи, и сменить её текст на месте React уже не сможет. Ключи
              у соседей разные: одинаковые (оба `section`) React в сборке не
              различал, и старые заголовки не удалялись — копились над новыми. */}
          <SplitReveal key={`title-${section}`} as="h1" className="fin-section-title" duration={0.9}>
            {ALL_SECTIONS.find((item) => item.key === section)?.title ?? ""}
          </SplitReveal>
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
          <FadeIn key={`body-${section}`}>{content}</FadeIn>
        </main>
      </div>

      {dialogKind && dictionaries ? (
        <OperationDialog
          kind={dialogKind}
          plan={dialogPlan}
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
