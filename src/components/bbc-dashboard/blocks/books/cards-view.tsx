"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Field, Row } from "@/components/books/api";
import { displayValue } from "@/components/books/field-value";
import { PAGE, type BookTable } from "@/components/books/use-book-table";
import { useFillHeight } from "@/components/books/use-fill-height";

/**
 * Карточки — те же строки для того, кто не работает таблицами.
 *
 * Смысл вида не в том, что он красивее. Строка журнала — это 24 колонки, из
 * которых человека, ищущего свою операцию, интересуют четыре: когда, кому,
 * сколько и по какому договору. В таблице эти четыре разбросаны по ширине в
 * полторы тысячи пикселей; здесь они собраны в одно место, а остальные
 * двадцать открываются по нажатию.
 *
 * Что показать — выводится из привязок колонок к ролям, а не прибито к книге
 * этой компании. Другая компания привезёт свой журнал с другими названиями
 * колонок; пока её колонки размечены, карточка соберётся сама. Если разметки
 * нет вовсе, берутся первые колонки книги — это честнее, чем пустая карточка.
 */

/** Роль → что она означает в карточке. Порядок внутри группы — приоритет. */
const AS_TITLE = ["client", "counterparty", "firm"];
const AS_DATE = ["entry_date", "signed_at", "invoice_date", "avr_date", "period_start"];
const AS_AMOUNT = ["inflow", "outflow", "contract_amount", "paid_amount", "debt", "saldo_end"];
/** Приток показывается со знаком «+», отток — со знаком «−». */
const NEGATIVE = new Set(["outflow", "debt"]);
const AS_LINE = [
  "contract_no", "invoice_no", "account", "category", "subcategory",
  "project", "product", "status", "payroll_detail", "comment",
];

type Layout = {
  title: Field | null;
  date: Field | null;
  amounts: Field[];
  lines: Field[];
};

function planCard(fields: Field[], bindings: Record<string, string>): Layout {
  const byRole = new Map<string, Field>();
  for (const field of fields) {
    const role = bindings[field.key];
    if (role && !byRole.has(role)) byRole.set(role, field);
  }
  const pick = (roles: string[]) => roles.map((r) => byRole.get(r)).filter(Boolean) as Field[];

  const title = pick(AS_TITLE)[0] ?? null;
  const date = pick(AS_DATE)[0] ?? null;
  const amounts = pick(AS_AMOUNT).slice(0, 2);
  const used = new Set([title, date, ...amounts].filter(Boolean).map((f) => (f as Field).key));
  let lines = pick(AS_LINE).filter((field) => !used.has(field.key)).slice(0, 3);

  if (!title && !date && amounts.length === 0 && lines.length === 0) {
    // Книга не размечена. Первые колонки — не догадка о смысле, а признание,
    // что смысла мы пока не знаем: показываем начало строки как есть.
    lines = fields.slice(0, 4);
  }
  return { title, date, amounts, lines };
}

/**
 * Уже со знаком — второй раз не приписываем.
 *
 * Дефис стоит первым намеренно. В `[+-−]` он оказывался между «+» (U+002B) и
 * «−» (U+2212) и переставал быть символом: получался диапазон длиной в полтора
 * десятка тысяч кодов, в который попадают все цифры. Проверка отвечала «знак
 * уже есть» на любую сумму, и ни один плюс с минусом на карточках не
 * появился ни разу — молча, потому что выражение остаётся правильным.
 */
const SIGNED = /^[-+−]/;

/** Чем подписана карточка: контрагентом, а если его нет — датой. */
function headOf(row: Row, layout: Layout): string {
  const title = layout.title
    ? displayValue(layout.title, row.values?.[layout.title.key])
    : "";
  if (title) return title;
  return layout.date ? displayValue(layout.date, row.values?.[layout.date.key]) : "";
}

/** Дата отдельной строкой — только если она не ушла в заголовок. */
function whenOf(row: Row, layout: Layout): string {
  if (!layout.date) return "";
  const date = displayValue(layout.date, row.values?.[layout.date.key]);
  return date && date !== headOf(row, layout) ? date : "";
}

/**
 * Сырая дата операции — по ней карточки собираются в дни.
 *
 * Именно сырое значение, а не показанное: показанное зависит от типа колонки и
 * может оказаться пустым, а группировать надо по тому, что в книге записано.
 */
function dayOf(row: Row, layout: Layout): string {
  if (!layout.date) return "";
  const raw = row.values?.[layout.date.key];
  return raw === null || raw === undefined ? "" : String(raw).slice(0, 10);
}

/** «4 августа 2026» — заголовок дня. Год не прячем: книга живёт годами. */
function dayTitle(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return day || "Без даты";
  return at.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type Props = {
  data: BookTable;
  canWrite: boolean;
  onOpenRecord: (row: Row) => void;
};

export function CardsView({ data, canWrite, onOpenRecord }: Props) {
  const { fields, bindings, rows, total, ensure, roleTitles } = data;
  const [shown, setShown] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  // Та же мера, что у таблицы: список карточек кончается вместе с окном.
  const { ref: box, height } = useFillHeight(240);

  const layout = useMemo(() => planCard(fields, bindings), [fields, bindings]);

  /** Следующая порция едет, когда до конца списка осталось доскроллить. */
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      setShown((now) => {
        if (now >= total) return now;
        const next = Math.min(total, now + PAGE);
        ensure(now, next);
        return next;
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [total, ensure]);

  // Довести глаз до новой карточки. Только прокрутка — это работа с DOM;
  // отметка «свежая» снимается не здесь, а когда человек сам что-то сделает.
  const fresh = data.lastAdded;
  useEffect(() => {
    if (fresh === null) return;
    const timer = window.requestAnimationFrame(() => {
      document.querySelector("[data-fresh]")?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(timer);
  }, [fresh]);

  // Только что заведённые записи держим отдельно и не показываем дважды.
  const justAdded = data.added;
  const freshIds = new Set(justAdded.map((row) => row.id));
  const visible = rows
    .slice(0, Math.min(shown, total))
    .filter((row) => !row || !freshIds.has(row.id));

  /**
   * Карточки собраны в дни.
   *
   * Без этого экран был россыпью одинаковых плиток: три с половиной тысячи
   * карточек подряд, и ни одной опоры для глаза — человек не понимал, где он и
   * по какому правилу это разложено. Журнал ведут по дням, и день — та самая
   * опора, которой не хватало.
   *
   * Порядок задаёт сервер (хроникой), здесь только расставляются заголовки:
   * группировать заново на клиенте значило бы разложить по дням ту сотню
   * строк, что доехала, и назвать это днями всей книги.
   */
  const days: Array<{ day: string; from: number; rows: Array<Row | undefined> }> = [];
  visible.forEach((row, index) => {
    const day = row ? dayOf(row, layout) : days[days.length - 1]?.day ?? "";
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, from: index, rows: [row] });
  });

  return (
    <div className="bbc-cards" ref={box} style={{ height }}>
      {/*
        Заведённое только что — наверху и до перечитывания книги.

        В хронике новой записи места нет: даты у неё ещё нет, и она уезжает в
        конец, за три с половиной тысячи строк. Человек заполнил форму и не
        увидел результата — этот дефект в разделе уже случался, и порядок «по
        дате» вернул бы его.
      */}
      {justAdded.length > 0 && (
        <section className="bbc-day" data-fresh-group="">
          <h3 className="bbc-day-title">
            Только что добавлено
            <span className="bbc-day-count">
              {justAdded.length} {plural(justAdded.length, "запись", "записи", "записей")}
            </span>
          </h3>
          <div className="bbc-day-cards">
            {justAdded.map((row) => renderCard(row, -1, ""))}
          </div>
        </section>
      )}

      {days.map((group) => (
        <section key={`${group.day}|${group.from}`} className="bbc-day">
          <h3 className="bbc-day-title">
            {group.day ? dayTitle(group.day) : "Без даты"}
            <span className="bbc-day-count">
              {group.rows.length} {plural(group.rows.length, "запись", "записи", "записей")}
            </span>
          </h3>
          <div className="bbc-day-cards">
            {group.rows.map((row, at) => renderCard(row, group.from + at, group.day))}
          </div>
        </section>
      ))}
      <div ref={sentinel} className="bbc-cards-end" />
    </div>
  );

  function renderCard(row: Row | undefined, index: number, day: string) {
    return row ? (
          <article
            key={row.id}
            className="bbc-card"
            data-fresh={index === -1 ? "" : undefined}
          >
            <button
              type="button"
              className="bbc-card-open"
              onClick={() => {
                // Человек взялся за работу — отметка «только что добавлена»
                // своё отслужила и снимается здесь, а не эффектом сразу после
                // появления: иначе рамку никто не успел бы увидеть.
                data.forgetLastAdded();
                onOpenRecord(row);
              }}
              aria-label={canWrite ? "Открыть запись для правки" : "Открыть запись"}
            />
            <header className="bbc-card-head">
              {/* Заголовок — первое, что у строки есть: контрагент, а если его
                  не заполнили — дата. Подставлять «Без названия» нельзя: это
                  подпись ни о чём на месте, где человек ищет свою операцию. */}
              <h4>{headOf(row, layout) || "—"}</h4>
              {layout.amounts.map((field) => {
                const text = displayValue(field, row.values?.[field.key]);
                if (!text) return null;
                const sign = NEGATIVE.has(bindings[field.key]) ? "−" : "+";
                return (
                  <b key={field.key} className="bbc-card-sum">
                    {SIGNED.test(text) ? text : `${sign}${text}`}
                  </b>
                );
              })}
            </header>

            {/* Дата в карточке — только если она НЕ та, что стоит в заголовке
                дня. Под «1 сентября 2026» каждая карточка со своим «01.09.2026»
                — это девяносто семь раз повторённое одно и то же. */}
            {dayOf(row, layout) !== day && whenOf(row, layout) && (
              <p className="bbc-card-when">{whenOf(row, layout)}</p>
            )}

            <dl className="bbc-card-lines">
              {layout.lines.map((field) => {
                const text = displayValue(field, row.values?.[field.key]);
                if (!text) return null;
                const role = bindings[field.key];
                return (
                  <div key={field.key}>
                    <dt>{(role && roleTitles[role]) || field.title}</dt>
                    <dd>{text}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
    ) : (
      <article key={`slot-${index}`} className="bbc-card" data-pending="" aria-hidden />
    );
  }
}

/** Русское склонение по числу. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
