"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TYPE_LABEL, type Field, type Row } from "@/components/books/api";
import { editValue, FieldEditor } from "@/components/books/field-value";
import type { BookTable } from "@/components/books/use-book-table";
import { useScrollLock } from "@/components/use-scroll-lock";

/**
 * Форма записи — собирается по схеме книги, а не пишется под каждую.
 *
 * Тип поля выбирает контрол: деньги и числа — числовое поле, дата — календарь,
 * список — поле с подсказками из книги, флажок — выбор. Поэтому раздел
 * работает с любой книгой, включая ту, которую заведёт другая компания: чтобы
 * появилась новая форма, кода писать не надо.
 *
 * Порядок полей: сначала те, у которых есть роль. Они означают величины, по
 * которым дашборд считает, и заполнять их важнее. Остальные колонки книги
 * спрятаны под «Показать остальные» — их в журнале два десятка, и вываливать
 * их сразу значит спрятать главное среди служебного.
 *
 * Отправляются только тронутые поля
 * ─────────────────────────────────
 * Раньше форма собирала все непустые поля и отправляла их скопом. Отсюда шли
 * две беды сразу. Стереть ошибочную сумму было нечем: пустое значение
 * отбрасывалось, и старое оставалось в книге при любом сохранении. А двое,
 * правившие разные колонки одной строки, затирали друг друга — второй
 * отправлял всю строку целиком, включая колонку, которую не трогал.
 *
 * Теперь в запрос идёт разница с тем, что было открыто. Пустая строка в ней —
 * законное значение и означает «стереть», а не «пропустить».
 */

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type Props = {
  data: BookTable;
  /** Правим существующую строку; пусто — заводим новую. */
  row: Row | null;
  canWrite: boolean;
  onClose: () => void;
};

/** Что лежит в полях формы для этой строки. Пусто — заводим новую. */
function seed(fields: Field[], row: Row | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) values[field.key] = editValue(field, row?.values?.[field.key]);
  return values;
}

export function RecordModal({ data, row, canWrite, onClose }: Props) {
  /**
   * Поля заполняются один раз, при открытии, и больше ниоткуда.
   *
   * Раньше форма пересобирала значения эффектом, следящим за схемой вкладки. А
   * схема приезжает с каждым чтением страницы — и любое фоновое чтение,
   * случившееся, пока человек печатал, возвращало поля к тому, что лежит в
   * базе. Набранное исчезало без единой ошибки на экране.
   *
   * Теперь снимок «как было» и текущие значения — два ленивых начальных
   * состояния, а форму пересобирает `key` в родителе: одна открытая карточка —
   * одна форма. Ни эффекта, ни повода затереть чужой ввод.
   */
  const [opened] = useState<Record<string, string>>(() => seed(data.fields, row));
  const [values, setValues] = useState<Record<string, string>>(() => seed(data.fields, row));
  const [showRest, setShowRest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useScrollLock(true);

  const { bound, rest } = useMemo(() => {
    const bindings = data.bindings;
    return {
      bound: data.fields.filter((field) => bindings[field.key]),
      rest: data.fields.filter((field) => !bindings[field.key]),
    };
  }, [data.fields, data.bindings]);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const changed = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => value !== opened[key]),
    );

    try {
      if (row) {
        if (Object.keys(changed).length === 0) {
          onClose();
          return;
        }
        const saved = await data.patch(row, changed);
        if (!saved) {
          setError(data.error || "Не удалось сохранить запись");
          return;
        }
      } else {
        const filled = Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== ""),
        );
        const saved = await data.create(filled);
        if (!saved) {
          setError(data.error || "Не удалось добавить запись");
          return;
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function drop() {
    if (!row) return;
    setBusy(true);
    const ok = await data.remove(row);
    setBusy(false);
    if (ok) onClose();
    else setError(data.error || "Не удалось убрать запись");
  }

  const titles = data.roleTitles;
  const bindings = data.bindings;

  function control(field: Field) {
    const role = bindings[field.key];
    const label = field.title || field.key;
    const hint = role ? titles[role] ?? role : TYPE_LABEL[field.type] ?? field.type;
    const inputId = `rec-${field.key}`;

    return (
      <div key={field.key} className="bbc-reg-field">
        <label className="bbc-reg-label" htmlFor={inputId}>
          {label}
          <span className="bbc-reg-role">{hint}</span>
        </label>
        <FieldEditor
          id={inputId}
          field={field}
          className="input-field"
          value={values[field.key] ?? ""}
          onChange={(next) =>
            setValues((current) => ({ ...current, [field.key]: next }))
          }
        />
      </div>
    );
  }

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={row ? "Правка записи" : "Новая запись"}
        tabIndex={-1}
        className="bbc-modal outline-none"
      >
        <div className="bbc-modal-head">
          <div className="min-w-0">
            <h2 className="font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {row ? "Правка записи" : "Новая запись"}
            </h2>
            <p className="bbc-reg-sub">{data.meta?.name}</p>
          </div>
          <button type="button" className="btn-ghost text-xs px-2.5 py-1.5" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <form onSubmit={submit} className="bbc-reg-form">
          <div className="bbc-modal-body">
            <div className="bbc-reg-grid">{bound.map(control)}</div>

            {rest.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn-ghost text-xs px-2.5 py-1.5 bbc-reg-more"
                  onClick={() => setShowRest((current) => !current)}
                >
                  {showRest
                    ? "Скрыть остальные колонки"
                    : `Показать остальные колонки (${rest.length})`}
                </button>
                {showRest && <div className="bbc-reg-grid">{rest.map(control)}</div>}
              </>
            )}

            {error && (
              <p className="bbc-reg-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="bbc-reg-foot">
            {row && canWrite && (
              <button
                type="button"
                className="btn-ghost bbc-reg-drop"
                onClick={() => (confirmDrop ? drop() : setConfirmDrop(true))}
                onBlur={() => setConfirmDrop(false)}
                disabled={busy}
              >
                {confirmDrop ? "Точно убрать?" : "Убрать"}
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Отмена
            </button>
            {canWrite && (
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Сохраняем…" : row ? "Сохранить" : "Добавить"}
              </button>
            )}
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
