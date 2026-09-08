"use client";

/**
 * Журнал касаний — вся работа по долгам в одном месте.
 *
 * Отвечает на два вопроса, ради которых его и просили:
 *   1. Сколько раз и до кого достучались — «Жанара 3 раза главбуху, 1 раз
 *      проджект-менеджеру», а директор туда же писал сам.
 *   2. Что конкретно было сказано и чем это подтверждается.
 *
 * Первый — сводкой сверху, второй — лентой снизу. Не наоборот: цифры читают
 * каждый день, а конкретную формулировку — когда уже что-то случилось.
 *
 * Раскладка повторяет дебиторку: крупная цифра с подписью, ряд фильтров-таблеток
 * в карточке, ниже данные. Второй язык на соседней вкладке читался бы как чужой
 * продукт.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  BbcApiError,
  deleteTouch,
  fetchTouchOptions,
  fetchTouches,
  openFileAccess,
  touchFileUrl,
} from "../../api";
import { ConfirmDialog } from "../../confirm-dialog";
import { dateLabel, plural } from "../../format";
import { ChevronRightIcon, TouchesIcon } from "../../icon";
import type { BbcRow, BbcTouch, BbcTouchOptions } from "../../types";
import { clientKey } from "../receivables/debt";
import { describeAuthor, overview } from "./summary";
import { TouchModal } from "./touch-modal";

export function TouchesBlock({
  rows,
  canWrite,
  /** Открыли из реестра дебиторки по конкретному должнику. */
  focusClient,
  onClearFocus,
}: {
  rows: BbcRow[];
  canWrite: boolean;
  focusClient?: string | null;
  onClearFocus?: () => void;
}) {
  const [touches, setTouches] = useState<BbcTouch[]>([]);
  const [options, setOptions] = useState<BbcTouchOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clientFilter, setClientFilter] = useState(focusClient ?? "");
  const [authorFilter, setAuthorFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BbcTouch | null>(null);
  /** Касание, для которого открыт вопрос «точно убрать?». */
  const [pendingDelete, setPendingDelete] = useState<BbcTouch | null>(null);

  // Клиенты, по которым этому человеку вообще есть что писать: те же строки,
  // что он видит в дебиторке. Свободный ввод здесь был бы ловушкой — имя должно
  // совпасть с книгой, иначе касание повиснет в стороне от долга.
  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const name = (row.client || "").trim();
      if (name) seen.set(clientKey(name), name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [rows]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTouches(await fetchTouches());
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось прочитать журнал");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetchTouchOptions().then(setOptions).catch(() => setOptions(null));
    // Cookie для вложений. Нужна только пришедшему по ссылке отдела: `<a href>`
    // заголовок X-BBC-Link поставить не может, а класть токен в адрес файла
    // нельзя — он оттуда уезжает в историю браузера и в пересланную ссылку.
    void openFileAccess();
  }, [load]);

  useEffect(() => {
    if (focusClient) setClientFilter(focusClient);
  }, [focusClient]);

  const visible = useMemo(() => {
    const key = clientFilter ? clientKey(clientFilter) : "";
    return touches.filter(
      (touch) =>
        (!key || touch.client_key === key) &&
        (!authorFilter || touch.author === authorFilter) &&
        (!roleFilter || touch.contact_role === roleFilter),
    );
  }, [touches, clientFilter, authorFilter, roleFilter]);

  const stats = useMemo(() => overview(visible), [visible]);
  const authors = useMemo(
    () => [...new Set(touches.map((t) => t.author))].sort((a, b) => a.localeCompare(b, "ru")),
    [touches],
  );

  // Должности показываем только те, что реально встречались: пустая таблетка
  // «Юрист», по которой ничего не найдётся, — обещание, которого нет.
  const usedRoles = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const touch of touches) {
      const entry = counts.get(touch.contact_role) ?? { name: touch.contact_role_name, count: 0 };
      entry.count += 1;
      counts.set(touch.contact_role, entry);
    }
    return [...counts.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count);
  }, [touches]);

  async function remove(touch: BbcTouch) {
    try {
      await deleteTouch(touch.id);
      setPendingDelete(null);
      void load();
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось удалить");
      setPendingDelete(null);
    }
  }

  function reset() {
    setClientFilter("");
    setAuthorFilter("");
    setRoleFilter("");
    onClearFocus?.();
  }

  const filtered = !!clientFilter || !!authorFilter || !!roleFilter;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Заголовок: крупная цифра и подпись, как в дебиторке ─────────── */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-2xl font-semibold bbc-num" style={{ color: "var(--text-primary)" }}>
            {stats.total}{" "}
            <span className="text-base font-normal" style={{ color: "var(--text-secondary)" }}>
              {plural(stats.total, "касание", "касания", "касаний")}
            </span>
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {clientFilter
              ? clientFilter
              : `по ${stats.clients} ${plural(stats.clients, "должнику", "должникам", "должникам")}`}
            {stats.lastContact ? ` · последнее ${dateLabel(stats.lastContact)}` : ""}
            {stats.withFiles > 0
              ? ` · ${stats.withFiles} ${plural(stats.withFiles, "с подтверждением", "с подтверждением", "с подтверждением")}`
              : ""}
          </p>
        </div>

        {canWrite ? (
          <button
            type="button"
            className="btn-primary text-xs px-3 py-1.5"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            disabled={!clients.length}
            title={clients.length ? undefined : "Нет должников, по которым можно писать"}
          >
            <TouchesIcon size={14} />
            Записать касание
          </button>
        ) : null}
      </div>

      {/* ── Фильтры: тот же ряд таблеток, что в реестре ─────────────────── */}
      <div className="card p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="bbc-scroll-x flex items-center gap-1 min-w-0">
          <Pill label="Все" active={!roleFilter} onClick={() => setRoleFilter("")} count={touches.length} />
          {usedRoles.map((role) => (
            <Pill
              key={role.key}
              label={role.name}
              count={role.count}
              active={roleFilter === role.key}
              onClick={() => setRoleFilter(roleFilter === role.key ? "" : role.key)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Picker
            label="Должник"
            value={clientFilter}
            options={clients}
            onChange={(value) => {
              setClientFilter(value);
              onClearFocus?.();
            }}
          />
          {authors.length > 1 ? (
            <Picker label="Кто писал" value={authorFilter} options={authors} onChange={setAuthorFilter} />
          ) : null}
          {filtered ? (
            <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={reset}>
              Сбросить
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div
          className="card p-4 text-sm"
          style={{ color: "var(--accent-rose)", borderColor: "var(--outflow-border)" }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* ── Кто до кого достучался ─────────────────────────────────────── */}
      {stats.authors.length > 0 ? (
        <div className="card overflow-hidden">
          <div className="bbc-touch-head">
            <span className="eyebrow">Кто до кого достучался</span>
          </div>
          {stats.authors.map((author) => (
            <div key={author.author} className="bbc-touch-author">
              <span className="bbc-avatar" aria-hidden="true">
                {author.author.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block text-sm font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {author.author}
                </span>
                {/* Предложением, а не таблицей: ровно так этот вопрос и задают. */}
                <span className="block text-xs" style={{ color: "var(--text-secondary)" }}>
                  {describeAuthor(author)}
                </span>
              </span>
              <span className="bbc-micro shrink-0 bbc-num" style={{ color: "var(--text-muted)" }}>
                {dateLabel(author.lastContact)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Лента ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
          Читаем журнал…
        </div>
      ) : !visible.length ? (
        <div className="card p-10 text-center">
          <p className="text-sm mb-1" style={{ color: "var(--text-primary)" }}>
            {filtered ? "Под фильтры не попало ни одно касание" : "Касаний пока нет"}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {filtered
              ? "Снимите фильтры, чтобы увидеть остальные."
              : "Первое можно записать отсюда или кнопкой «Работа с долгом» в реестре дебиторки."}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {visible.map((touch) => (
            <TouchRow
              key={touch.id}
              touch={touch}
              canWrite={canWrite}
              showClient={!clientFilter}
              onEdit={() => {
                setEditing(touch);
                setModalOpen(true);
              }}
              onDelete={() => setPendingDelete(touch)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Убрать касание из журнала?"
        body={
          pendingDelete ? (
            <>
              {pendingDelete.author} → {pendingDelete.contact_role_name}, {dateLabel(pendingDelete.contacted_at)},
              «{pendingDelete.client}». Запись исчезнет с экрана, но останется в базе — история работы
              по долгу это доказательная база, и стереть её насовсем нельзя.
            </>
          ) : null
        }
        confirmLabel="Убрать"
        destructive
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />

      <TouchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={load}
        options={options}
        clients={clients}
        initial={editing}
        presetClient={editing ? undefined : clientFilter || undefined}
      />
    </div>
  );
}

/** Таблетка фильтра — тот же элемент, что переключает отделы в реестре. */
function Pill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="bbc-pill" data-active={active ? "" : undefined} onClick={onClick}>
      <span className="truncate">{label}</span>
      <span className="bbc-num bbc-pill-count">{count}</span>
    </button>
  );
}

/**
 * Выпадающий список своей вёрстки, а не нативный `<select>`.
 *
 * Список должников бывает на две сотни строк, и нативный попап рисует его
 * системой — без поиска, своим шрифтом и своим фоном. Здесь же он часть
 * страницы: ищется, скроллится и выглядит как всё остальное.
 */
function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onAway(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
    return list.slice(0, 200);
  }, [options, query]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-ghost text-xs px-3 py-1.5 max-w-[13rem]"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate">{value || label}</span>
        {/* Шеврон вниз, а не вправо: вправо он обещает переход на другой экран,
            а здесь раскрывается список под кнопкой. Поворот, а не вторая
            иконка — набор значков модуля и так свой, плодить его незачем. */}
        <span
          aria-hidden="true"
          className="shrink-0 flex transition-transform"
          style={{
            transform: open ? "rotate(-90deg)" : "rotate(90deg)",
            transitionDuration: "var(--dur-fast)",
          }}
        >
          <ChevronRightIcon size={12} />
        </span>
      </button>

      {open ? (
        <div
          className="absolute right-0 z-30 mt-1 card p-1 flex flex-col"
          style={{ width: "16rem", boxShadow: "var(--shadow-float)" }}
          role="listbox"
        >
          <input
            className="input-field mb-1"
            style={{ fontSize: "0.8125rem", padding: "0.4rem 0.6rem" }}
            placeholder="Поиск…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <div className="overflow-y-auto" style={{ maxHeight: "16rem" }}>
            <button
              type="button"
              className="bbc-option"
              data-active={!value ? "" : undefined}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Все
            </button>
            {shown.map((option) => (
              <button
                key={option}
                type="button"
                className="bbc-option"
                data-active={value === option ? "" : undefined}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {option}
              </button>
            ))}
            {!shown.length ? (
              <p className="text-xs px-2 py-3 text-center" style={{ color: "var(--text-muted)" }}>
                Ничего не нашлось
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TouchRow({
  touch,
  canWrite,
  showClient,
  onEdit,
  onDelete,
}: {
  touch: BbcTouch;
  canWrite: boolean;
  showClient: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="bbc-touch-row">
      <span className="bbc-avatar shrink-0" aria-hidden="true">
        {touch.author.trim().charAt(0).toUpperCase() || "?"}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          {showClient ? (
            <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {touch.client}
            </span>
          ) : null}
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {touch.author} → {touch.contact_role_name}
            {touch.contact_name ? ` · ${touch.contact_name}` : ""}
          </span>
          <span
            className="bbc-micro ml-auto shrink-0 bbc-num"
            style={{ color: "var(--text-muted)" }}
          >
            {dateLabel(touch.contacted_at)} · {touch.channel_name}
          </span>
        </div>

        <p
          className="text-xs mt-1 leading-relaxed"
          style={{ color: "var(--text-secondary)", overflowWrap: "anywhere" }}
        >
          {touch.summary}
        </p>

        {touch.files.length ? (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {touch.files.map((file) => (
              <a
                key={file.id}
                href={touchFileUrl(file.id)}
                target="_blank"
                rel="noreferrer"
                className="bbc-file-chip"
              >
                {file.filename}
              </a>
            ))}
          </div>
        ) : null}

        {canWrite ? (
          <div className="bbc-touch-actions">
            <button type="button" className="btn-ghost bbc-micro px-2 py-1" onClick={onEdit}>
              Править
            </button>
            <button
              type="button"
              className="btn-ghost bbc-micro px-2 py-1"
              onClick={onDelete}
              style={{ color: "var(--accent-rose)" }}
            >
              Убрать
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
