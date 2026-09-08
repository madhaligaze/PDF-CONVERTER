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

  const visible = rows.slice(0, Math.min(shown, total));

  return (
    <div className="bbc-cards" ref={box} style={{ height }}>
      {visible.map((row, index) =>
        row ? (
          <article
            key={row.id}
            className="bbc-card"
            data-fresh={data.lastAdded === index ? "" : undefined}
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

            {whenOf(row, layout) && (
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
        ),
      )}
      <div ref={sentinel} className="bbc-cards-end" />
    </div>
  );
}
