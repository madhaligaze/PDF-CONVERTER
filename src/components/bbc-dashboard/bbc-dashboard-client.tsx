"use client";

/**
 * BBC Dashboard — the shell.
 *
 * Holds the three things every block shares: who is asking (scope), what is
 * filtered, and which recognition mode is active. The blocks below are pure
 * views over that state.
 *
 * Access is decided by the backend: an admin session sees everything, a referral
 * link sees one department, anyone else gets the login screen. The block
 * navigation only offers what the caller's scope actually allows — and the data
 * behind it was already filtered server-side, so hiding a tab is presentation,
 * not the security boundary.
 */
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { RefreshIcon } from "@/components/icons";
import { currentLinkToken } from "./api";
import { DepartmentBanner } from "./access/department-banner";
import { LoginScreen } from "./access/login-screen";
import { SetPasswordScreen } from "./access/set-password-screen";
import { BootScreen, useBootFarewell } from "./shell/boot-screen";
import { TouchesBlock } from "./blocks/touches";
import { AnalyticsBlock } from "./blocks/analytics";
import { CalendarBlock } from "./blocks/calendar";
import { ControlPanelBlock } from "./blocks/control-panel";
import { JournalBlock } from "./blocks/journal";
import { RoadmapBlock } from "./blocks/pending";
import { SalesBlock } from "./blocks/sales";
import { ReceivablesBlock } from "./blocks/receivables";
import { BooksBlock } from "@/components/bbc-dashboard/blocks/books";
import { ReportsBlock } from "./blocks/reports";
import { WarningsBlock } from "./blocks/warnings";
import { CommandPalette } from "./command-palette";
import { ContextStrip, LayoutDriftNote, LiveFailureBanner, LiveIndicator } from "./controls";
import { MenuIcon, MoreIcon, UserIcon } from "./icon";
import { ActionsSheet } from "./mobile/actions-sheet";
import { ControlSheet } from "./mobile/control-sheet";
import { MobileDrawer } from "./shell/mobile-drawer";
import { Sidebar } from "./shell/sidebar";
import { CONTROL_BLOCK, allowedBlocksFor } from "./shell/nav-items";
import { department } from "./department";
import { type SavedView, useSavedViews } from "./saved-views";
import { useDataset } from "./use-dataset";
import { useLive } from "./use-live";

/**
 * Смена раздела через нативный View Transitions API.
 *
 * Библиотека для этого не нужна: браузер сам снимает «до» и «после» и заводит
 * между ними псевдоэлементы, которые докрашиваются в globals.css. Имя перехода
 * висит только на области блока, поэтому шапка и панель фильтров не замирают на
 * время анимации. Где API нет (Firefox, Safari до 18) — обычный setState, и
 * раздел просто меняется мгновенно.
 */
type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

function withViewTransition(update: () => void) {
  const doc = typeof document === "undefined" ? null : (document as DocumentWithViewTransition);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!doc?.startViewTransition || reduced) {
    update();
    return;
  }
  // flushSync обязателен: браузер снимает второй кадр сразу после колбэка, а
  // асинхронный рендер React в него не успел бы.
  doc.startViewTransition(() => flushSync(update));
}

export function BbcDashboardClient() {
  const {
    dataset,
    me,
    adoptIdentity,
    rows,
    filters,
    setFilters,
    toggleFilter,
    clearFilters,
    activeFilterCount,
    mode,
    setMode,
    block,
    setBlock,
    phase,
    loading,
    error,
    errorDetail,
    unauthorized,
    reload,
    refreshCooldown,
    source,
    setSource,
  } = useDataset();

  const onLiveChange = useCallback(() => {
    void reload();
  }, [reload]);

  // Живой опрос следит за ревизией листа Google, и для внутренней книги он не
  // просто бесполезен, а вреден: у книги ревизии нет (ноль), опрос видит у
  // листа большее число, считает это изменением и перечитывает набор — и так
  // каждые пять секунд без конца.
  const live = useLive(
    dataset?.revision,
    onLiveChange,
    !unauthorized && !!dataset && source === "sheets",
  );

  const linkToken = typeof window === "undefined" ? null : currentLinkToken();

  const { views, save: saveView, remove: removeView } = useSavedViews();

  // Из `me`, а не из области видимости набора данных: с появлением учёток
  // сотрудников косвенный признак «в departments есть *» врёт — у сотрудника с
  // data_scope=all там тоже нет звёздочки, но админом он от этого не стал.
  const isAdmin = me?.is_admin ?? false;

  /**
   * Экран отдела: свой тон и своя шапка.
   *
   * Ссылка всегда выдаётся на один отдел, поэтому берём первый код области
   * видимости. Для админа отдела нет — у него весь дашборд.
   */
  const departmentInfo = isAdmin ? null : department(dataset?.scope.departments[0]);
  const tone = departmentInfo?.tone;

  /**
   * Разделы для меню. Область видимости берётся из набора данных, а когда его
   * нет — из `me`.
   *
   * Запасной источник заведён ради экрана отказа. Раньше меню висело на
   * `dataset`, и при неудачном чтении таблицы навигация исчезала вместе с
   * данными: человек оставался с сообщением об ошибке на пустой странице, без
   * единого способа уйти в другой раздел. Права в `me` те же самые — сервер
   * присылает их ещё до чтения таблицы, — так что показывать нечего лишнего.
   */
  const allowedBlocks = useMemo(() => {
    const granted = dataset?.scope.blocks ?? me?.blocks;
    return granted ? allowedBlocksFor(granted) : [];
  }, [dataset, me]);

  const activeBlock = useMemo(() => {
    if (!allowedBlocks.length) return null;
    return allowedBlocks.find((item) => item.key === block) ?? allowedBlocks[0];
  }, [allowedBlocks, block]);

  // Куда возвращает кнопка «К разделу»: тот раздел с данными, из которого ушли
  // в настройки, а не первый попавшийся. Запоминается в самом переходе — это
  // обработчик события, а не эффект, поэтому лишнего каскада рендеров нет.
  const [lastDataBlock, setLastDataBlock] = useState("receivables");

  /** Какой лист открыт на телефоне. Ни один из них не влияет на раскладку. */
  const [sheet, setSheet] = useState<"menu" | "actions" | "control" | null>(null);
  /** Должник, по которому провалились из реестра дебиторки в журнал касаний. */
  const [touchClient, setTouchClient] = useState<string | null>(null);
  // Палитра управляется отсюда: на телефоне её кнопки в шапке нет, и открывают
  // её из листа действий.
  const [paletteOpen, setPaletteOpen] = useState(false);

  const router = useRouter();

  const goToBlock = useCallback(
    (key: string) => {
      const current = activeBlock?.key;
      if (current && current !== CONTROL_BLOCK.key && current !== key) setLastDataBlock(current);

      // Лист закрывается до перехода и отдельным обновлением: иначе он попадёт
      // в «старый» снимок View Transition и будет уезжать вместе с разделом.
      setSheet(null);

      withViewTransition(() => setBlock(key));

      // Прокрутка наверх — снаружи flushSync: скролл во время съёмки снял бы
      // неверное смещение. `behavior: "auto"` обязателен явно, иначе
      // `html { scroll-behavior: smooth }` из globals.css запустит плавный
      // скролл на ~400мс против 220мс перехода, и они подерутся.
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [activeBlock, setBlock],
  );

  const applyView = useCallback(
    (view: SavedView) => {
      setFilters(view.filters);
      setMode(view.mode);
      goToBlock(view.block);
    },
    [setFilters, setMode, goToBlock],
  );

  // Хуки — до ранних возвратов: порядок вызова обязан совпадать между
  // рендерами, а ниже стоят `return` на вход и на смену пароля.
  const booting = loading && !dataset;
  const farewell = useBootFarewell(booting);

  const onPanel = activeBlock?.key === CONTROL_BLOCK.key;
  const backBlock =
    allowedBlocks.find((item) => item.key === lastDataBlock) ?? allowedBlocks[0];

  // Сотрудник вошёл, но пароля у него по сути нет — тот, что выдали, остался в
  // переписке. Проверка стоит ДО `unauthorized`: область видимости такой учётки
  // пуста, и без этого он увидел бы форму входа, в которую только что вошёл.
  if (me?.authenticated && me.must_change_password) {
    return (
      <SetPasswordScreen
        fullName={me.full_name ?? ""}
        // Смена гасит сессию — дальше обычный вход с новым паролем.
        onChanged={() => window.location.reload()}
      />
    );
  }

  if (unauthorized) {
    // `linkExpired` distinguishes "never signed in" from "the link stopped
    // working while you were reading" — the second needs a different message.
    return (
      <LoginScreen
        needsSetup={me?.needs_setup ?? false}
        linkExpired={!!linkToken}
        onSignedIn={adoptIdentity}
      />
    );
  }

  if (booting) {
    return <BootScreen phase={phase} />;
  }

  return (
    <div
      // На экране отдела тон расходится по карточкам и активному пункту меню —
      // это и делает его «своим», не добавляя в систему второго акцентного
      // цвета.
      //
      // Раскладка — две колонки: слева подложка сайдбара шириной ровно 56px,
      // справа всё остальное. Раскрытая панель ложится поверх правой колонки и
      // ничего в ней не двигает.
      className={`min-h-screen min-h-[100svh] flex${departmentInfo ? " bbc-dept" : ""}`}
      style={{ background: "var(--page-bg)", ...(tone ? { "--dept-tone": tone } : null) } as CSSProperties}
    >
      {/* Экран загрузки не исчезает, а расходится: дашборд уже проявляется
          снизу вверх своим обычным входом, а этот слой в те же 380мс складывает
          столбцы и тает. Два движения накладываются и читаются как одно. */}
      {farewell ? (
        <div className="bbc-boot-farewell">
          <BootScreen phase="done" />
        </div>
      ) : null}

      {/* По списку разделов, а не по набору данных: при отказе чтения таблицы
          навигация обязана остаться на месте. Счётчик предупреждений без
          данных неизвестен — тогда его просто нет, а не ноль. */}
      {allowedBlocks.length ? (
        <Sidebar
          blocks={allowedBlocks}
          activeKey={activeBlock?.key}
          warningCount={dataset?.warnings_summary.total ?? 0}
          onSelect={goToBlock}
        />
      ) : null}

      {/* min-w-0 обязателен: без него широкая таблица внутри распирает
          flex-колонку, и горизонтальная прокрутка уезжает на всю страницу
          вместо своего контейнера. */}
      <div className="flex-1 min-w-0 flex flex-col">
      {/* Шапка. На телефоне залипает не она целиком, а только верхняя строка:
          баннер отдела и строка контекста уезжают со страницей. Три залипающих
          ряда съедали пятую часть экрана и не отдавали её. */}
      <header
        className="bbc-enter bbc-header border-b"
        style={
          {
            background: "var(--header-bg)",
            borderColor: "var(--border-subtle)",
            "--enter-index": 0,
          } as CSSProperties
        }
      >
        <div
          className="bbc-header-bar flex items-center justify-between gap-2 px-4 py-2.5"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Бургер — единственный вход в разделы на телефоне. only-mobile,
                а не sm:hidden: у .btn-ghost свой display из globals.css, и
                утилита Tailwind проиграла бы ему по каскаду молча. */}
            <button
              type="button"
              onClick={() => setSheet("menu")}
              className="btn-ghost only-mobile items-center justify-center px-2 py-1.5"
              aria-label="Разделы"
              aria-haspopup="dialog"
              aria-expanded={sheet === "menu"}
            >
              <MenuIcon size={18} />
            </button>
            {/* Кнопки «Назад» тут больше нет. Она вела на /services, то есть
                уводила из дашборда целиком, а называлась так, будто делает шаг
                назад по истории — жмёшь и оказываешься не там. Выход переехал
                на логотип в сайдбаре, где подписан словами «к сервисам». */}
            {/* Заголовок называет открытый раздел, а не продукт: сайдбар и так
                подписан, а вот куда ты провалился — на телефоне видно только
                отсюда. */}
            <span
              className="font-semibold truncate"
              style={{
                color: "var(--text-primary)",
                letterSpacing: "-0.01em",
                fontSize: "var(--ios-title)",
              }}
            >
              {activeBlock?.title ?? "BBC · управленческий отчёт"}
            </span>

          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="sm:hidden">
              <LiveIndicator live={live} compact />
            </span>
            <span className="hidden sm:inline-flex">
              <LiveIndicator live={live} />
            </span>

            {/* Телефон: всё остальное из шапки — в лист действий. */}
            <button
              type="button"
              onClick={() => setSheet("actions")}
              className="btn-ghost only-mobile items-center justify-center px-2.5 py-1.5"
              aria-label="Действия"
              aria-haspopup="dialog"
            >
              <MoreIcon size={16} />
            </button>

            <span className="hidden sm:contents">
            {dataset ? (
              <CommandPalette
                dataset={dataset}
                blocks={allowedBlocks.map((item) => ({ key: item.key, title: item.title }))}
                savedViews={views}
                onBlock={goToBlock}
                onMode={setMode}
                onFilter={toggleFilter}
                onSearch={(value) => setFilters((current) => ({ ...current, search: value }))}
                onApplyView={applyView}
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
              />
            ) : null}
            {/* Ручное чтение идёт прямо в Google мимо фонового цикла, поэтому у
                кнопки есть остывание: «не обновилось» обычно означает «в таблице
                не меняли», а не «нажми ещё десять раз». */}
            {/*
              Откуда взяты цифры. Не украшение и не режим просмотра: это
              разные источники одних и тех же величин, и пока идёт переезд,
              их надо уметь сверить. Разошлись — видно сразу, а не через
              квартал в отчёте.

              Подписью, а не точкой: активный источник отличается весом и
              фоном. Цветного индикатора «данные свежие» здесь нет намеренно —
              горящий постоянно, он перестаёт что-либо значить.
            */}
            <div className="bbc-source" role="group" aria-label="Откуда взяты цифры">
              {/* Подпись обязательна. Без неё в шапке стояли два слова,
                  «Google» и «Книга», и по ним нельзя было догадаться ни что
                  это переключает, ни почему их два. Прячется на телефоне через
                  `.only-desktop`, а не `sm:hidden`: у элемента есть класс из
                  globals.css, и утилита display на нём не сработает. */}
              <span className="bbc-source-label only-desktop">Цифры из</span>
              <button
                type="button"
                className={source === "sheets" ? "bbc-source-on" : ""}
                onClick={() => setSource("sheets")}
                disabled={loading}
                title="Считать по книгам Google напрямую — так, как было всегда"
              >
                Google
              </button>
              <button
                type="button"
                className={source === "books" ? "bbc-source-on" : ""}
                onClick={() => setSource("books")}
                disabled={loading}
                title="Считать по внутренней копии книги — той, что открыта в разделе «Книги»"
              >
                Книги
              </button>
            </div>
            <button
              type="button"
              onClick={() => void reload(true)}
              disabled={loading || refreshCooldown > 0 || source === "books"}
              className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
              title={
                source === "books"
                  ? "Цифры взяты из внутренней книги — перечитывать нечего. Книга обновляется, когда её привозят из Google в разделе «Книги»."
                  : refreshCooldown > 0
                    ? `Только что читали таблицу. Следующее ручное чтение через ${refreshCooldown} с — фоновое обновление идёт само каждые 15 секунд.`
                    : "Перечитать таблицу сейчас"
              }
            >
              <RefreshIcon size={15} />
              <span className="hidden sm:inline">
                {loading ? "Обновление…" : refreshCooldown > 0 ? `${refreshCooldown} с` : "Обновить"}
              </span>
            </button>
            {/* Кабинет открыт всем, у кого есть учётка: сотруднику там видны
                заходы в его дашборд и кнопка отключить чужое устройство.
                Держателю ссылки отдела — нет: у ссылки нет учётки, а значит и
                своих заходов, и кабинет ответил бы ему пустотой. */}
            {me?.authenticated && !me?.link_label ? (
              <Link
                href="/bbc-dashboard/account"
                prefetch
                className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                title="Личный кабинет"
              >
                <UserIcon size={15} />
                <span className="hidden sm:inline">Кабинет</span>
              </Link>
            ) : null}
            </span>
          </div>
        </div>

        {/* Сбой источника на телефоне — своей строкой: в шапке из одной строки
            для подписи места нет, а прятать это состояние нельзя. */}
        <LiveFailureBanner live={live} />

        {/* Книгу поправили, но всё прочиталось — не сбой, а примечание. */}
        <LayoutDriftNote layout={dataset?.layout} />

        {dataset && departmentInfo ? (
          <DepartmentBanner
            info={departmentInfo}
            rowCount={dataset.rows.length}
            blocks={dataset.scope.blocks}
            expiresAt={me?.link_expires_at}
          />
        ) : null}

        {/* Панель уехала в свою вкладку, но подпись под цифрой осталась здесь. */}
        {dataset && !onPanel ? (
          <ContextStrip
            dataset={dataset}
            mode={mode}
            filters={filters}
            activeCount={activeFilterCount}
            visibleRows={rows.length}
            totalRows={dataset.rows.length}
            live={live}
            onOpen={() => goToBlock(CONTROL_BLOCK.key)}
            onOpenSheet={() => setSheet("control")}
            onToggle={toggleFilter}
            onClear={clearFilters}
            tone={tone}
          />
        ) : null}
      </header>

      <main
        className="bbc-enter bbc-main flex-1 w-full max-w-[1400px] mx-auto px-4 py-5 flex flex-col gap-4"
        style={{ "--enter-index": 3 } as CSSProperties}
      >
        {/* Отказ — состояние экрана, а не строчка сверху.
            Раньше здесь стояла узкая красная плашка, в которую попадал текст
            прямо из ответа сервера: при проверке вся страница состояла из
            слова «boom», а при пропаже сети — из «Failed to fetch». Теперь
            сказано, что случилось, чем это грозит данным и что нажать; сама
            служебная строка убрана под «Подробности» — она нужна тому, кто
            будет чинить, а не тому, кто смотрит отчёт. */}
        {error ? (
          <div className="card p-6 flex flex-col gap-3" role="alert" aria-live="polite">
            <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {error}
            </h3>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {dataset
                ? "На экране данные с прошлого удачного чтения — они могли устареть."
                : "Данные за этот раз прочитать не удалось. Сама таблица цела: сервис только читает её и ничего в ней не меняет."}
            </p>
            {/* Отдельной подписи «когда читали удачно» здесь нет намеренно:
                свежесть данных живёт в шапке одной строкой на весь экран, и
                второй счётчик рядом с кнопкой означал бы два разных времени
                про одно и то же. */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void reload(true)}
                disabled={loading}
                className="btn-primary text-sm px-3.5 py-2 flex items-center gap-2"
              >
                <RefreshIcon size={15} />
                {loading ? "Читаем…" : "Попробовать снова"}
              </button>
            </div>
            {errorDetail ? (
              <details className="mono-meta">
                <summary className="cursor-pointer select-none">Подробности</summary>
                <p className="pt-1.5" style={{ color: "var(--text-muted)" }}>
                  {errorDetail}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {dataset ? (
          <>
            {activeBlock ? (
              <div className="bbc-block-view flex flex-col gap-4">
                <h2 className="sr-only">{activeBlock.title}</h2>
                {activeBlock.key === CONTROL_BLOCK.key ? (
                  <ControlPanelBlock
                    dataset={dataset}
                    rows={rows}
                    mode={mode}
                    onMode={setMode}
                    filters={filters}
                    onToggleFilter={toggleFilter}
                    onSearch={(value) => setFilters((current) => ({ ...current, search: value }))}
                    onClearFilters={clearFilters}
                    activeFilterCount={activeFilterCount}
                    views={views}
                    onSaveView={(name) => saveView(name, lastDataBlock, mode, filters)}
                    onApplyView={applyView}
                    onRemoveView={removeView}
                    onBack={() => goToBlock(backBlock?.key ?? "receivables")}
                    backTitle={backBlock?.title ?? "Дебиторка"}
                    restricted={!isAdmin}
                    tone={tone}
                  />
                ) : null}
                {activeBlock.key === "receivables" ? (
                  <ReceivablesBlock
                    dataset={dataset}
                    rows={rows}
                    mode={mode}
                    filters={filters}
                    onToggleFilter={toggleFilter}
                    onSearch={(value) => setFilters((current) => ({ ...current, search: value }))}
                    onClearFilters={clearFilters}
                    activeFilterCount={activeFilterCount}
                    // Кнопка «Работа с долгом» появляется, только если журнал
                    // вообще открыт этому вызывающему — иначе она вела бы в
                    // раздел, которого он не увидит.
                    onOpenTouches={
                      allowedBlocks.some((item) => item.key === "touches")
                        ? (client) => {
                            setTouchClient(client);
                            goToBlock("touches");
                          }
                        : undefined
                    }
                  />
                ) : null}
                {activeBlock.key === "touches" ? (
                  <TouchesBlock
                    rows={rows}
                    // Держатель ссылки отдела может читать журнал, но не писать
                    // в него: у ссылки нет автора, и подписать касание нечем.
                    canWrite={!!me?.authenticated && !me?.link_label}
                    focusClient={touchClient}
                    onClearFocus={() => setTouchClient(null)}
                  />
                ) : null}
                {activeBlock.key === "registries" ? (
                  <BooksBlock
                    // Держатель ссылки отдела читает книгу, но не пишет в
                    // неё: у ссылки нет автора, и подписать запись нечем —
                    // то же правило, что в журнале касаний.
                    canWrite={!!me?.authenticated && !me?.link_label}
                  />
                ) : null}
                {activeBlock.key === "reports" ? <ReportsBlock rows={rows} mode={mode} /> : null}
                {activeBlock.key === "analytics" ? (
                  <AnalyticsBlock rows={rows} mode={mode} onFilter={toggleFilter} />
                ) : null}
                {activeBlock.key === "journal" ? <JournalBlock /> : null}
                {activeBlock.key === "calendar" ? <CalendarBlock /> : null}
                {activeBlock.key === "sales" ? <SalesBlock /> : null}
                {activeBlock.key === "warnings" ? (
                  <WarningsBlock
                    warnings={dataset.warnings}
                    summary={dataset.warnings_summary}
                    coverage={dataset.coverage}
                    rows={dataset.rows}
                  />
                ) : null}
                {activeBlock.key === "roadmap" ? <RoadmapBlock /> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </main>

      {/* ── Телефон ──────────────────────────────────────────────────────
          Ящик стоит вне `.bbc-block-view`, поэтому View Transition его не
          трогает — и правильно: постоянный элемент интерфейса не должен
          мигать на каждом переключении раздела. */}
      {dataset ? (
        <>
          <MobileDrawer
            open={sheet === "menu"}
            onClose={() => setSheet(null)}
            blocks={allowedBlocks}
            activeKey={activeBlock?.key}
            warningCount={dataset.warnings_summary.total}
            onSelect={goToBlock}
          />

          <ActionsSheet
            open={sheet === "actions"}
            onClose={() => setSheet(null)}
            loading={loading}
            refreshCooldown={refreshCooldown}
            onRefresh={() => {
              setSheet(null);
              void reload(true);
            }}
            onSearch={() => {
              setSheet(null);
              setPaletteOpen(true);
            }}
            isAdmin={isAdmin}
            onAccount={() => router.push("/bbc-dashboard/account")}
            onServices={() => router.push("/services")}
            source={source}
            onSource={(next) => {
              setSheet(null);
              setSource(next);
            }}
          />

          <ControlSheet
            open={sheet === "control"}
            onClose={() => setSheet(null)}
            dataset={dataset}
            mode={mode}
            onMode={setMode}
            filters={filters}
            onToggleFilter={toggleFilter}
            onSearch={(value) => setFilters((current) => ({ ...current, search: value }))}
            onClearFilters={clearFilters}
            activeFilterCount={activeFilterCount}
            visibleRows={rows.length}
            totalRows={dataset.rows.length}
            onOpenPanel={() => goToBlock(CONTROL_BLOCK.key)}
          />
        </>
      ) : null}
      </div>
    </div>
  );
}
