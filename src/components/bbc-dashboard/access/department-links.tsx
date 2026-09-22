"use client";

/**
 * Department access links — the core of the account page.
 *
 * One row per department: the short code, «Сформировать ссылку», the address,
 * a clock that sets how long the link lives, and a cross that revokes it.
 *
 * Адрес приходит с сервера при каждом чтении списка, поэтому он остаётся в поле
 * после перезагрузки страницы, а не живёт до первого F5. Часы работают в любой
 * момент, а не только до выдачи: срок меняется у уже выданной ссылки, адрес при
 * этом не меняется — иначе у получателя ломалось бы то, что ему уже отправили.
 * Когда время выходит, строка на глазах переходит в «истекла» и адрес пропадает.
 *
 * Область видимости по-прежнему лежит на сервере рядом с хэшем токена: править
 * ссылку в адресной строке бессмысленно.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useScrollLock } from "../../use-scroll-lock";
import { BbcApiError, createLink, fetchLinks, revokeLink, updateLinkExpiry } from "../api";
import { CheckIcon, ClockIcon, CopyIcon, LinkIcon } from "../icon";
import { dateLabel, plural, relativeTime } from "../format";
import { deadlineLabel, useCountdown } from "../use-countdown";
import type { BbcLink } from "../types";

/** Codes as typed in «Отдел», with the readable name shown next to them. */
const DEPARTMENTS: Array<{ code: string; name: string }> = [
  { code: "ОБО", name: "Бухгалтерский отдел" },
  { code: "НО", name: "Налоговый отдел" },
  { code: "ЮО", name: "Юридический отдел" },
  { code: "HR", name: "Кадровый отдел" },
  { code: "ФО", name: "Финансовый отдел" },
];

/** Быстрые сроки в модалке, в минутах. */
const QUICK: Array<{ label: string; minutes: number }> = [
  { label: "15 минут", minutes: 15 },
  { label: "1 час", minutes: 60 },
  { label: "8 часов", minutes: 8 * 60 },
  { label: "24 часа", minutes: 24 * 60 },
  { label: "7 дней", minutes: 7 * 24 * 60 },
];

export function DepartmentLinks({
  initialLinks,
  loading = false,
}: {
  /** Список, загруженный страницей параллельно с личностью. */
  initialLinks?: BbcLink[];
  loading?: boolean;
}) {
  const [links, setLinks] = useState<BbcLink[]>(initialLinks ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (initialLinks) setLinks(initialLinks);
  }, [initialLinks]);

  const reload = useCallback(async () => {
    try {
      setLinks(await fetchLinks());
      setError(null);
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось загрузить ссылки");
    }
  }, []);

  /**
   * Все действующие ссылки отдела, а не только последняя.
   *
   * Строка в списке одна на отдел, но ссылок за ней может стоять несколько —
   * например, если её выдали повторно, не отозвав старую. Раньше крестик снимал
   * только новейшую, и доступ по прежней продолжал работать: человек видел
   * «отозвано», а отдел оставался открыт. Поэтому отзыв идёт по всем сразу.
   */
  const byDepartment = useMemo(() => {
    const map = new Map<string, BbcLink[]>();
    for (const link of links) {
      if (!link.is_active) continue;
      const bucket = map.get(link.label);
      if (bucket) bucket.push(link);
      else map.set(link.label, [link]);
    }
    return map;
  }, [links]);

  async function run(code: string, action: () => Promise<unknown>, failure: string) {
    setBusy(code);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : failure);
    } finally {
      setBusy(null);
    }
  }

  const openCount = DEPARTMENTS.filter((item) => byDepartment.get(item.code)?.length).length;

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Ссылки для руководителей отделов
        </h2>
        {/* Считаем открытые отделы, а не строки в таблице ссылок: строка в
            списке одна на отдел, и «2 активных» при одной видимой строке
            читалось как потерянная ссылка. */}
        <span className="mono-meta">
          {openCount} из {DEPARTMENTS.length} отделов открыто
        </span>
      </div>
      <p className="text-xs mb-5 max-w-2xl" style={{ color: "var(--text-secondary)" }}>
        По ссылке руководитель видит дебиторку, аналитику и платёжный календарь{" "}
        <strong style={{ color: "var(--text-primary)" }}>только своего отдела</strong>. Область
        видимости привязана к ссылке на сервере — изменить её в адресной строке нельзя. Срок можно
        задать в любой момент: по кнопке с часами, не выдавая ссылку заново.
      </p>

      {error ? (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-4"
          style={{
            color: "var(--accent-rose)",
            background: "var(--outflow-bg)",
            border: "1px solid var(--outflow-border)",
          }}
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {DEPARTMENTS.map((department, index) => {
          const open = byDepartment.get(department.code) ?? [];
          return (
            <DepartmentRow
              key={department.code}
              code={department.code}
              name={department.name}
              link={open[0]}
              extra={open.length - 1}
              loading={loading}
              busy={busy === department.code}
              index={index}
              onIssue={(minutes) =>
                run(
                  department.code,
                  () => createLink(department.code, minutes === null ? null : minutes / 60),
                  "Не удалось создать ссылку",
                )
              }
              onExpiry={(minutes) =>
                run(
                  department.code,
                  () => updateLinkExpiry(open[0].id, minutes),
                  "Не удалось изменить срок",
                )
              }
              onRevoke={() =>
                run(
                  department.code,
                  async () => {
                    for (const link of open) await revokeLink(link.id);
                  },
                  "Не удалось отозвать доступ",
                )
              }
              onExpired={reload}
            />
          );
        })}
      </div>
    </section>
  );
}

type RowProps = {
  code: string;
  name: string;
  link: BbcLink | undefined;
  /** Сколько ещё действующих ссылок у отдела помимо показанной. */
  extra: number;
  loading: boolean;
  busy: boolean;
  index: number;
  onIssue: (minutes: number | null) => void;
  onExpiry: (minutes: number | null) => void;
  onRevoke: () => void;
  onExpired: () => void;
};

function DepartmentRow({
  code,
  name,
  link,
  extra,
  loading,
  busy,
  index,
  onIssue,
  onExpiry,
  onRevoke,
  onExpired,
}: RowProps) {
  // Момент открытия модалки: от него считается «во сколько закроется».
  // Часы снимаются в обработчике, а не в рендере — рендер обязан быть чистым.
  const [picker, setPicker] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const countdown = useCountdown(link?.expires_at);

  // Дошли до нуля — перечитываем список, чтобы сервер подтвердил то, что уже
  // показано: ссылка мертва, адрес из поля ушёл.
  const expired = countdown.expired;
  useEffect(() => {
    if (expired) onExpired();
  }, [expired, onExpired]);

  // Локально «истекла» наступает раньше, чем ответит сервер, и это правильно:
  // показывать копируемый адрес после конца срока нельзя.
  const live = link && !expired;

  async function copy() {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure origin / permissions) — the field is
      // selectable, so the user can still copy by hand.
    }
  }

  return (
    <div
      className="row-item p-3 animate-fade-in"
      style={{
        animationDelay: `calc(${index} * var(--dur-stagger))`,
        animationFillMode: "backwards",
      }}
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        {/* Short department code — the button from the brief */}
        <span
          className="flex items-center justify-center font-semibold text-xs shrink-0"
          style={{
            width: 44,
            height: 32,
            borderRadius: "var(--radius-btn)",
            background: live ? "var(--accent-soft)" : "var(--bg-active)",
            border: `1px solid ${live ? "var(--accent-line)" : "var(--border-base)"}`,
            color: live ? "var(--text-accent)" : "var(--text-secondary)",
            transition: "background var(--dur-fast), border-color var(--dur-fast)",
          }}
          title={name}
        >
          {code}
        </span>

        <span className="text-xs hidden sm:inline shrink-0" style={{ color: "var(--text-muted)" }}>
          {name}
        </span>

        <div className="flex-1" />

        {loading && !link ? (
          // Пока список не пришёл, «Сформировать ссылку» читалось бы как
          // «ссылки нет» — а она, может быть, есть. Молчим до ответа.
          <span
            className="rounded-lg"
            aria-hidden="true"
            style={{ width: 160, height: 28, background: "var(--bg-active)", opacity: 0.6 }}
          />
        ) : !live ? (
          <button
            type="button"
            className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
            onClick={() => onIssue(null)}
            disabled={busy}
          >
            <LinkIcon size={14} />
            {busy ? "Создаём…" : link ? "Выдать заново" : "Сформировать ссылку"}
          </button>
        ) : (
          <>
            {link.url ? (
              <>
                <input
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className="input-field text-xs flex-1 min-w-[200px]"
                  style={{ fontFamily: "var(--font-martian), ui-monospace, monospace" }}
                  aria-label={`Ссылка для отдела ${code}`}
                />
                <button
                  type="button"
                  className="btn-ghost text-xs p-1.5"
                  onClick={copy}
                  title="Скопировать"
                  aria-label="Скопировать ссылку"
                >
                  {copied ? (
                    <span style={{ color: "var(--accent-emerald)" }}>
                      <CheckIcon size={15} />
                    </span>
                  ) : (
                    <CopyIcon size={15} />
                  )}
                </button>
              </>
            ) : (
              // Ссылка выдана до того, как адреса начали храниться: показать
              // нечего, поэтому предлагаем выдать заново, а не пустое поле.
              <>
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  Доступ открыт, но адрес этой ссылки не сохранён.
                </span>
                <button
                  type="button"
                  className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
                  onClick={onRevoke}
                  disabled={busy}
                  title="Отозвать и выдать новую"
                >
                  <LinkIcon size={14} />
                  Выдать заново
                </button>
              </>
            )}

            <button
              type="button"
              className="btn-ghost text-xs p-1.5"
              onClick={() => setPicker(Date.now())}
              title={
                link.expires_at
                  ? `Срок действия: ${deadlineLabel(link.expires_at)}`
                  : "Сделать ссылку временной"
              }
              aria-label="Задать срок действия"
              style={link.expires_at ? { color: "var(--accent-amber)" } : undefined}
            >
              <ClockIcon size={15} />
            </button>

            <button
              type="button"
              className="btn-ghost text-xs p-1.5"
              onClick={onRevoke}
              disabled={busy}
              title={
                extra > 0
                  ? `Отозвать все действующие ссылки отдела (${extra + 1})`
                  : "Отозвать доступ по этой ссылке"
              }
              aria-label={`Отозвать доступ для отдела ${code}`}
              style={{ color: "var(--accent-rose)" }}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {link ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pl-1">
          {expired ? (
            <span className="mono-meta" style={{ color: "var(--accent-rose)" }}>
              срок истёк — ссылка больше не работает
            </span>
          ) : link.expires_at ? (
            <span
              className="mono-meta"
              style={{ color: countdown.urgent ? "var(--accent-rose)" : "var(--accent-amber)" }}
              title={`Доступ закроется ${deadlineLabel(link.expires_at)}`}
            >
              осталось {countdown.label}
            </span>
          ) : (
            <span className="mono-meta">бессрочная</span>
          )}
          <span className="mono-meta">
            переходов: {link.use_count}
            {link.last_used_at ? ` · ${relativeTime(link.last_used_at)}` : ""}
          </span>
          <span className="mono-meta">создана {dateLabel(link.created_at)}</span>
          {extra > 0 ? (
            <span className="mono-meta" style={{ color: "var(--accent-amber)" }}>
              + ещё {extra} {plural(extra, "действующая", "действующие", "действующих")} — крестик
              отзовёт все
            </span>
          ) : null}
        </div>
      ) : null}

      {picker !== null && link ? (
        <ExpiryDialog
          code={code}
          current={link.expires_at}
          openedAt={picker}
          onClose={() => setPicker(null)}
          onApply={(minutes) => {
            setPicker(null);
            onExpiry(minutes);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── Модалка срока ───────────────────────────────────────────────────────────── */

/**
 * Диалог «сколько эта ссылка живёт».
 *
 * Раньше на месте часов раскрывался список из пяти фиксированных вариантов, да
 * и то лишь до выдачи ссылки. Здесь и быстрые варианты, и точная сборка из часов
 * с минутами, и — главное — сразу видно, во сколько именно доступ закроется.
 */
function ExpiryDialog({
  code,
  current,
  openedAt,
  onClose,
  onApply,
}: {
  code: string;
  current: string | null;
  /** Отсчёт «закроется в …» ведётся от последнего действия пользователя. */
  openedAt: number;
  onClose: () => void;
  onApply: (minutes: number | null) => void;
}) {
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [base, setBase] = useState(openedAt);

  const total = Math.max(0, Math.round(hours) * 60 + Math.round(minutes));
  const preview = total > 0 ? deadlineLabel(new Date(base + total * 60_000).toISOString()) : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useScrollLock(true);

  // Порталом в body — как и палитра: любой предок с backdrop-filter или
  // will-change превращает `position: fixed` в отсчёт от себя, и подложка
  // перестаёт закрывать экран.
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Срок действия ссылки для отдела ${code}`}
        className="bbc-dialog fixed z-50 left-1/2 top-[18vh] w-[min(92vw,420px)] card p-5 animate-slide-up overflow-y-auto"
        style={{ transform: "translateX(-50%)", boxShadow: "var(--shadow-float)", maxHeight: "88svh" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <ClockIcon size={15} />
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Сколько живёт ссылка {code}
          </h3>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          {current
            ? `Сейчас доступ закрывается ${deadlineLabel(current)}. Новый срок считается от этой минуты.`
            : "Сейчас ссылка бессрочная. Адрес при смене срока не меняется."}
        </p>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {QUICK.map((item) => (
            <button
              key={item.minutes}
              type="button"
              className="btn-ghost text-xs px-2.5 py-1.5"
              onClick={() => onApply(item.minutes)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-3 mb-4">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Часы</span>
            <input
              className="input-field text-sm w-20"
              type="number"
              min={0}
              max={720}
              value={hours}
              onChange={(event) => {
                setBase(Date.now());
                setHours(Math.max(0, Number(event.target.value) || 0));
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Минуты</span>
            <input
              className="input-field text-sm w-20"
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(event) => {
                setBase(Date.now());
                setMinutes(Math.min(59, Math.max(0, Number(event.target.value) || 0)));
              }}
            />
          </label>
          <p className="text-xs pb-2" style={{ color: "var(--text-muted)" }}>
            {preview ? `закроется ${preview}` : "укажите время больше нуля"}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-primary text-xs px-4 py-2"
            disabled={total <= 0}
            onClick={() => onApply(total)}
          >
            Применить
          </button>
          <button type="button" className="btn-ghost text-xs px-3 py-2" onClick={() => onApply(null)}>
            Сделать бессрочной
          </button>
          <button type="button" className="btn-ghost text-xs px-3 py-2 ml-auto" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
