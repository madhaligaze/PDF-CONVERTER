"use client";

/**
 * «Реестр» — список строк, а не плитки (фронт-план 6.1).
 *
 * 460 договоров сравнивают по колонке: сумма под суммой, срок под сроком.
 * Сетка одинаковых карточек этому мешает — «приложенческий» вид здесь значит
 * список строк плюс карточка договора по центру.
 *
 * Вкладки — листы-отборы со счётчиками; при поиске счётчики показывают
 * найденное в каждом листе, и «где искать» видно без переключения. Строки не
 * исчезают под глазами: договор, ушедший из листа, стоит приглушённым до смены
 * вкладки. Цвет на экране в нормальном состоянии — только «N замечаний».
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type Contract,
  type Me,
  type Party,
  type PersonRef,
  type RegistrySchema,
  type RegistryView,
  contractsApi,
} from "@/components/finance/api";
import { SearchIcon } from "@/components/icons";
import { ContractCard, useCardRefresh } from "@/components/finance/contracts/contract-card";
import {
  bareNumber,
  contractMoney,
  formatDay,
  plural,
  shortName,
} from "@/components/finance/format";
import {
  counterpartTitle,
  isClosed,
  listText,
  ownSide,
  phaseOf,
  roleLabels,
  viewCounts,
} from "@/components/finance/contracts/schema";
import {
  boot,
  forgetDeparted,
  holdLive,
  pendingCount,
  useRegistry,
} from "@/components/finance/contracts/store";
import { readParam, writeParams } from "@/components/finance/address";
import { MenuPopover } from "@/components/finance/ui/menu-popover";
import { IndexList } from "@/components/stage/index-list";
import { gsap, prefersReducedMotion } from "@/components/motion/gsap";

type SortKey = "number" | "party" | "own" | "kind" | "amount" | "term" | "status" | "people";

const SORT_STORE = "fin_reg_sort";

function readSort(view: string): { key: SortKey; dir: 1 | -1 } | null {
  try {
    const raw = localStorage.getItem(`${SORT_STORE}:${view}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSort(view: string, sort: { key: SortKey; dir: 1 | -1 } | null): void {
  try {
    if (sort) localStorage.setItem(`${SORT_STORE}:${view}`, JSON.stringify(sort));
    else localStorage.removeItem(`${SORT_STORE}:${view}`);
  } catch {
    /* выбор живёт до перезагрузки */
  }
}

export function useRegistryBoot(me: Me): void {
  const company = me.company?.id ?? null;
  const user = me.user?.id ?? null;
  useEffect(() => {
    if (company) void boot(company, user);
  }, [company, user]);
  useEffect(() => holdLive(), []);
}

export function Registry({ me, onGo }: { me: Me; onGo: (section: string) => void }) {
  useRegistryBoot(me);
  const phase = useRegistry((s) => s.phase);
  const error = useRegistry((s) => s.error);
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const order = useRegistry((s) => s.order);
  const parties = useRegistry((s) => s.parties);
  const people = useRegistry((s) => s.people);
  const fresh = useRegistry((s) => s.fresh);
  const removed = useRegistry((s) => s.departed);

  const views = useMemo(() => [...(schema?.views ?? [])].sort((a, b) => a.position - b.position), [schema]);
  const [viewKey, setViewKey] = useState<string>(() => readParam("v") ?? "main");
  const view = views.find((item) => item.key === viewKey) ?? views[0];
  const [query, setQuery] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => readParam("id"));
  const [draft, setDraft] = useState<{ view?: string; block?: number } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [slowPhase, setSlowPhase] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const shown = useRef<Map<string, string>>(new Map());

  useCardRefresh(openId, !!openId);

  useEffect(() => {
    if (phase !== "boot") return;
    const timer = setTimeout(() => setSlowPhase(true), 400);
    return () => clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (view) setSort(readSort(view.key));
  }, [view]);

  const selectView = (key: string) => {
    setViewKey(key);
    setIssuesOnly(false);
    shown.current = new Map();
    forgetDeparted();
    writeParams({ v: key === "main" ? null : key }, false);
  };

  const openCard = useCallback((id: string | null) => {
    setOpenId(id);
    setDraft(null);
    writeParams({ id }, !!id);
  }, []);

  useEffect(() => {
    const onPop = () => setOpenId(readParam("id"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const needle = query.trim().toLowerCase();
  const matchesSearch = useCallback(
    (contract: Contract) => {
      if (!needle) return true;
      const executor = parties[String(contract.values.executor ?? "")];
      const customer = parties[String(contract.values.customer ?? "")];
      const hay = [
        String(contract.values.number ?? ""),
        executor?.name,
        customer?.name,
        executor?.code,
        customer?.code,
        executor?.bin,
        customer?.bin,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    },
    [needle, parties],
  );

  const all = useMemo(() => order.map((id) => byId.get(id)).filter((item): item is Contract => !!item && !item.deleted), [order, byId]);
  const counts = useMemo(() => viewCounts(views, all, needle ? matchesSearch : undefined), [views, all, needle, matchesSearch]);

  const rows = useMemo(() => {
    if (!view) return [] as { contract: Contract; block: number; departed?: string }[];
    const inside = all
      .filter((contract) => contract.views.some((place) => place.view === view.key))
      .filter(matchesSearch)
      .filter((contract) => !issuesOnly || contract.issues.some((issue) => !issue.acknowledged))
      .map((contract) => ({
        contract,
        block: contract.views.find((place) => place.view === view.key)?.block ?? 0,
        departed: undefined as string | undefined,
      }));
    // Ушедшие из листа строки остаются на месте приглушёнными до смены вкладки.
    // «Ушедший» — только тот, кто перестал подходить под правило листа или
    // убран. Отсеянный поиском или «замечаниями» не ушёл: его просто не ищут.
    const insideIds = new Set(inside.map((row) => row.contract.id));
    const leaving: { contract: Contract; block: number; departed?: string }[] = [];
    for (const [id, blockKey] of shown.current) {
      if (insideIds.has(id)) continue;
      const contract = byId.get(id);
      if (!contract) continue;
      if (!contract.deleted && contract.views.some((place) => place.view === view.key)) continue;
      if (!matchesSearch(contract)) continue;
      let text = "убран";
      if (!contract.deleted) {
        const target = views.find((other) => other.key !== view.key && !other.main && contract.views.some((place) => place.view === other.key));
        text = target ? `ушёл в «${target.title}»` : "ушёл из листа";
      } else if (removed.get(id)) text = removed.get(id) ?? text;
      leaving.push({ contract, block: Number(blockKey) || 0, departed: text });
    }
    const combined = [...inside, ...leaving];
    if (sort) {
      combined.sort((a, b) => compare(a.contract, b.contract, sort.key, schema, parties, people) * sort.dir);
    } else {
      // Лист из нескольких блоков показывает блоки подряд, как в файле:
      // сначала номер блока, внутри — порядок реестра.
      combined.sort((a, b) => a.block - b.block || a.contract.position - b.contract.position);
    }
    return combined;
  }, [view, all, byId, matchesSearch, issuesOnly, sort, views, removed, schema, parties, people]);

  useEffect(() => {
    const next = new Map<string, string>();
    for (const row of rows) if (!row.departed || shown.current.has(row.contract.id)) next.set(row.contract.id, String(row.block));
    shown.current = next;
  }, [rows]);

  const issueCount = useMemo(
    () =>
      all
        .filter((contract) => view && contract.views.some((place) => place.view === view.key))
        .filter(matchesSearch)
        .filter((contract) => contract.issues.some((issue) => !issue.acknowledged)).length,
    [all, view, matchesSearch],
  );

  const ids = rows.filter((row) => !row.departed).map((row) => row.contract.id);
  const index = openId ? ids.indexOf(openId) : -1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        search.current?.focus();
        return;
      }
      if (openId || draft) {
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault();
          const next = ids[index + (event.key === "ArrowDown" ? 1 : -1)];
          if (next) openCard(next);
        }
        return;
      }
      if (typing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const at = cursor ? ids.indexOf(cursor) : -1;
        const next = ids[Math.max(0, Math.min(ids.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
        if (next) {
          setCursor(next);
          document.getElementById(`creg-row-${next}`)?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, index, openId, draft, cursor, openCard]);

  const canEdit = !!schema?.access.edit;
  const canSetup = !!schema?.access.setup;

  if (phase === "error") {
    return (
      <div className="creg-empty">
        {error || "Реестр не прочитался"} ·{" "}
        <button type="button" className="fin-link-btn" onClick={() => me.company && boot(me.company.id, me.user?.id ?? null, true)}>
          Повторить
        </button>
      </div>
    );
  }
  if (phase !== "ready" || !schema || !view) {
    return <div className="creg-empty" style={{ opacity: slowPhase ? 1 : 0, transition: "opacity .3s" }}>Читаем реестр…</div>;
  }

  const newContract = () => {
    const singleBlock = view.blocks.length === 1 && !view.main ? 0 : undefined;
    setOpenId(null);
    setDraft({ view: view.main ? undefined : view.key, block: singleBlock });
  };

  const menu = [
    { label: "Загрузить Excel", hidden: !canSetup, onSelect: () => onGo("contracts-import") },
    { label: "Настроить реестр", hidden: !canSetup, onSelect: () => onGo("contracts-setup") },
    { label: "Скачать .xlsx", onSelect: () => (window.location.href = contractsApi.exportUrl()) },
  ];

  if (!all.length && !needle) {
    return (
      <>
        <div className="creg-top">
          <LiveLine />
          <div className="creg-top-actions">
            <MenuPopover items={menu} />
          </div>
        </div>
        {canSetup ? (
          <IndexList
            size="section"
            label="С чего начать реестр"
            entries={[
              { key: "import", title: "Загрузить Excel", meta: "реестр из файла", onSelect: () => onGo("contracts-import") },
              { key: "new", title: "Завести первый договор", meta: "с нуля", onSelect: newContract },
            ]}
          />
        ) : (
          <p className="creg-empty">Договоров пока нет</p>
        )}
        <ContractCard
          id={null}
          open={!!draft}
          draftContext={draft ?? undefined}
          onClose={() => setDraft(null)}
          onCreated={(id) => openCard(id)}
        />
      </>
    );
  }

  return (
    <>
      <div className="creg-top">
        <LiveLine />
        <div className="creg-top-actions">
          {canEdit ? (
            <button type="button" className="btn-primary only-desktop" onClick={newContract}>
              Новый договор
            </button>
          ) : null}
          <MenuPopover items={menu} />
        </div>
      </div>

      <div className="creg-bar">
        <Tabs views={views} active={view.key} counts={counts} onSelect={selectView} />
        <label className="creg-search">
          <span className="creg-search-ico">
            <SearchIcon size={15} />
          </span>
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Номер, контрагент или БИН"
            aria-label="Поиск по реестру"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
      </div>
      {issueCount > 0 ? (
        <button
          type="button"
          className="creg-issues-btn"
          aria-pressed={issuesOnly}
          onClick={() => setIssuesOnly((value) => !value)}
        >
          {issueCount} {plural(issueCount, "замечание", "замечания", "замечаний")}
        </button>
      ) : (
        <div style={{ height: "1.9rem" }} />
      )}

      <div className="creg-list">
        <Head
          sort={sort}
          onSort={(key) => {
            const next = !sort || sort.key !== key ? { key, dir: 1 as const } : sort.dir === 1 ? { key, dir: -1 as const } : null;
            setSort(next);
            writeSort(view.key, next);
          }}
        />
        {rows.length === 0 ? (
          <p className="creg-empty">
            {needle ? (
              <>
                Ничего не нашлось ·{" "}
                <button type="button" className="fin-link-btn" onClick={() => setQuery("")}>
                  Сбросить поиск
                </button>
              </>
            ) : (
              "В этом листе пока пусто"
            )}
          </p>
        ) : (
          <Rows
            view={view}
            rows={rows}
            grouped={view.blocks.length > 1 && !sort}
            openId={openId}
            fresh={fresh}
            needle={needle}
            onOpen={(id) => {
              setCursor(id);
              openCard(id);
            }}
          />
        )}
      </div>

      {canEdit ? (
        <button type="button" className="btn-primary creg-fab only-mobile" onClick={newContract} hidden={!!openId || !!draft}>
          + Новый договор
        </button>
      ) : null}

      <ContractCard
        id={openId}
        open={!!openId || !!draft}
        draftContext={draft ?? undefined}
        onClose={() => {
          if (openId) {
            const last = openId;
            openCard(null);
            requestAnimationFrame(() => document.getElementById(`creg-row-${last}`)?.focus({ preventScroll: true }));
          }
          setDraft(null);
        }}
        onCreated={(id) => openCard(id)}
        onPrev={index > 0 ? () => openCard(ids[index - 1]) : undefined}
        onNext={index >= 0 && index < ids.length - 1 ? () => openCard(ids[index + 1]) : undefined}
      />
    </>
  );
}

/** Строка живого состояния: в покое пустая, место держится. */
export function LiveLine() {
  const remote = useRegistry((s) => s.remote);
  const online = useRegistry((s) => s.live.online);
  const edits = useRegistry((s) => s.edits);
  const [now, setNow] = useState(() => Date.now());
  const latest = remote[0];
  useEffect(() => {
    if (!latest) return;
    const left = 8000 - (Date.now() - latest.at);
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [latest]);
  void edits;
  const waiting = pendingCount();
  if (!online) {
    return (
      <span className="creg-live" data-state="wait" role="status">
        Нет связи{waiting ? ` · правки ждут: ${waiting}` : ""}
      </span>
    );
  }
  const text = latest && now - latest.at < 8000 ? [latest.by, latest.number, latest.field].filter(Boolean).join(" · ") : "";
  return (
    <span className="creg-live" role="status" aria-live="polite">
      {text}
    </span>
  );
}

function Tabs({
  views,
  active,
  counts,
  onSelect,
}: {
  views: RegistryView[];
  active: string;
  counts: Record<string, number>;
  onSelect: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const host = root.current;
    const bar = line.current;
    const tab = host?.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`);
    if (!host || !bar || !tab) return;
    const to = { x: tab.offsetLeft, scaleX: tab.offsetWidth };
    if (first.current || prefersReducedMotion()) {
      gsap.set(bar, to);
      first.current = false;
    } else {
      gsap.to(bar, { ...to, duration: 0.45, ease: "expo.out", overwrite: "auto" });
    }
  }, [active, counts]);
  return (
    <div ref={root} className="creg-tabs" role="tablist" aria-label="Листы реестра">
      {views.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          data-key={item.key}
          aria-selected={item.key === active}
          className="creg-tab"
          onClick={() => onSelect(item.key)}
        >
          {item.title}
          <span className="creg-tab-count">{counts[item.key] ?? 0}</span>
        </button>
      ))}
      <span ref={line} className="creg-underline" aria-hidden="true" />
    </div>
  );
}

const COLUMNS: { key: SortKey; title: string; cls: string }[] = [
  { key: "number", title: "№", cls: "creg-col-num" },
  { key: "party", title: "Контрагент", cls: "" },
  { key: "own", title: "Наше", cls: "creg-col-own" },
  { key: "kind", title: "Вид", cls: "creg-col-kind" },
  { key: "amount", title: "Сумма", cls: "creg-money" },
  { key: "term", title: "Срок", cls: "creg-col-term" },
  { key: "status", title: "Статус", cls: "" },
  { key: "people", title: "Ответственные", cls: "creg-col-people" },
];

function Head({ sort, onSort }: { sort: { key: SortKey; dir: 1 | -1 } | null; onSort: (key: SortKey) => void }) {
  return (
    <div className="creg-head" role="row">
      {COLUMNS.map((column) => (
        <button
          key={column.key}
          type="button"
          role="columnheader"
          className={`eyebrow ${column.cls}`}
          aria-sort={sort?.key === column.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
          onClick={() => onSort(column.key)}
        >
          {column.title}
          {sort?.key === column.key ? (sort.dir === 1 ? " ↓" : " ↑") : ""}
        </button>
      ))}
      <span />
    </div>
  );
}

function Rows({
  view,
  rows,
  grouped,
  openId,
  fresh,
  needle,
  onOpen,
}: {
  view: RegistryView;
  rows: { contract: Contract; block: number; departed?: string }[];
  grouped: boolean;
  openId: string | null;
  fresh: ReadonlySet<string>;
  needle: string;
  onOpen: (id: string) => void;
}) {
  const schema = useRegistry((s) => s.schema);
  const parties = useRegistry((s) => s.parties);
  const people = useRegistry((s) => s.people);
  const out: React.ReactNode[] = [];
  let lastBlock = -1;
  const blockCounts: Record<number, number> = {};
  if (grouped) for (const row of rows) blockCounts[row.block] = (blockCounts[row.block] ?? 0) + 1;
  for (const row of rows) {
    if (grouped && row.block !== lastBlock) {
      lastBlock = row.block;
      const title = view.blocks[row.block]?.title || `Блок ${row.block + 1}`;
      out.push(
        <div key={`block-${row.block}`} className="creg-block-head" role="rowgroup">
          {title}
          <span>{blockCounts[row.block]}</span>
        </div>,
      );
    }
    const contract = row.contract;
    const title = counterpartTitle(contract, parties) || "—";
    const own = ownSide(contract, parties);
    const roles = roleLabels(contract);
    const phase = phaseOf(schema, contract);
    const issues = contract.issues.filter((issue) => !issue.acknowledged).length;
    const billing = String(contract.values.billing ?? "");
    const amount = contract.values.amount;
    const terms = String(contract.values.amount_terms ?? "");
    const personIds = Array.isArray(contract.values.people) ? (contract.values.people as string[]) : [];
    const firstPerson = personIds[0] ? shortName(people[personIds[0]]?.name) : "";
    const planned = String(contract.values.planned_end_at ?? "");
    const overdue = planned && planned < (schema?.today ?? "") && (phase === "active" || phase === "in_progress");
    const kind = listText(schema, "type", contract.values.type);
    const status = listText(schema, "status", contract.values.status);
    const number = bareNumber(contract.values.number);
    out.push(
      <div
        key={contract.id}
        id={`creg-row-${contract.id}`}
        role="row"
        tabIndex={0}
        className={`creg-row${fresh.has(contract.id) ? " creg-row-new" : ""}`}
        aria-selected={openId === contract.id}
        data-closed={isClosed(schema, contract) ? "true" : undefined}
        data-departed={row.departed ? "true" : undefined}
        onClick={() => !row.departed && onOpen(contract.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !row.departed) onOpen(contract.id);
        }}
      >
        <span className="creg-num creg-col-num" title={String(contract.values.number ?? "")}>
          {number || "—"}
        </span>
        <span className="creg-party" title={title}>
          <Highlight text={title} needle={needle} />
        </span>
        <span className="creg-col-own" title={own.slot === "customer" ? `${own.code} · ${roles.customer.toLowerCase()}` : own.code}>
          {own.code}
          {own.slot === "customer" ? <span className="fin-muted"> · {roles.customer.toLowerCase()}</span> : null}
        </span>
        <span className="creg-col-kind" title={kind}>
          {kind}
        </span>
        <span className="creg-money" title={terms || undefined}>
          {amount !== undefined ? (
            <>
              {contractMoney(amount)}
              {billing === "month" ? <small> /мес</small> : null}
            </>
          ) : terms ? (
            <span className="fin-muted">{terms}</span>
          ) : (
            ""
          )}
        </span>
        <span className={`creg-col-term${overdue ? " fin-fail" : ""}`}>{formatDay(planned)}</span>
        <span className="creg-status" data-phase={phase || undefined} title={status}>
          {status}
        </span>
        <span className="creg-col-people" title={personIds.map((id) => people[id]?.name ?? "").join(", ")}>
          {firstPerson}
          {personIds.length > 1 ? <span className="fin-muted"> +{personIds.length - 1}</span> : null}
        </span>
        {row.departed ? (
          <span className="creg-note">{row.departed}</span>
        ) : (
          <span className="creg-issues">{issues ? `${issues} ${plural(issues, "замечание", "замечания", "замечаний")}` : ""}</span>
        )}
        <span className="creg-meta">
          {[number, own.code, kind, phase !== "active" ? status : ""].filter(Boolean).join(" · ")}
          {issues ? <span className="fin-fail"> · {issues} замеч.</span> : null}
        </span>
      </div>,
    );
  }
  return <div role="rowgroup">{out}</div>;
}

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="creg-hit">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
}

function compare(
  a: Contract,
  b: Contract,
  key: SortKey,
  schema: RegistrySchema | null,
  parties: Readonly<Record<string, Party>>,
  people: Readonly<Record<string, PersonRef>>,
): number {
  const text = (value: string) => value.toLowerCase();
  switch (key) {
    case "number":
      return text(bareNumber(a.values.number)).localeCompare(text(bareNumber(b.values.number)), "ru", { numeric: true });
    case "party":
      return text(counterpartTitle(a, parties)).localeCompare(text(counterpartTitle(b, parties)), "ru");
    case "own":
      return ownSide(a, parties).code.localeCompare(ownSide(b, parties).code, "ru");
    case "kind":
      return listText(schema, "type", a.values.type).localeCompare(listText(schema, "type", b.values.type), "ru");
    case "amount":
      return Number(a.values.amount ?? -1) - Number(b.values.amount ?? -1);
    case "term":
      return String(a.values.planned_end_at ?? "9999").localeCompare(String(b.values.planned_end_at ?? "9999"));
    case "status":
      return listText(schema, "status", a.values.status).localeCompare(listText(schema, "status", b.values.status), "ru");
    case "people": {
      const name = (contract: Contract) => {
        const ids = contract.values.people as string[] | undefined;
        return ids?.[0] ? people[ids[0]]?.name ?? "" : "";
      };
      return name(a).localeCompare(name(b), "ru");
    }
    default:
      return 0;
  }
}
