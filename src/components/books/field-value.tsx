"use client";

import type { Field } from "@/components/books/api";

/**
 * Как выглядит и как правится значение ячейки — одним куском на все виды.
 *
 * Таблица и карточки показывают одни и те же строки. Пока правила показа
 * лежали в каждом виде свои, одна и та же сумма выглядела в них по-разному —
 * «150000.00» в гриде и «150 000,00 ₸» в карточке, — и человек не мог быть
 * уверен, что смотрит на одну строку. Правило показа обязано быть одно.
 *
 * Показ не додумывает. Если в денежной колонке лежит «уточнить», это и
 * останется «уточнить», а не превратится в ноль: в книгах, которые ведут
 * руками, текст в денежной колонке встречается регулярно, и подстановка нуля
 * там — выдуманный факт, который сложится в сумму.
 */

const THIN_NBSP = " ";

const NUMERIC = new Set(["money", "number"]);

/** Число из ячейки книги: «1 234,56», «1234.56», «-85 000,00». */
function toNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/[\s  ]/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.+-]/g, "");
  if (!cleaned || !/^[+-]?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Текст ячейки для показа. Пусто — пустая строка, а не «—». */
export function displayValue(field: Field, raw: unknown): string {
  const text = raw === null || raw === undefined ? "" : String(raw);
  if (!text) return "";

  if (NUMERIC.has(field.type)) {
    const value = toNumber(text);
    if (value === null) return text;
    return value
      .toLocaleString("ru-RU", {
        minimumFractionDigits: field.type === "money" ? 2 : 0,
        maximumFractionDigits: 2,
      })
      .replace(/ /g, THIN_NBSP);
  }

  if (field.type === "date") {
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;
    return text;
  }

  if (field.type === "bool") {
    const upper = text.trim().toUpperCase();
    if (["TRUE", "ДА", "1", "YES"].includes(upper)) return "да";
    if (["FALSE", "НЕТ", "0", "NO"].includes(upper)) return "нет";
  }

  return text;
}

/** Числа прижимаются вправо — так столбец сумм читается разрядами. */
export const isNumeric = (field: Field) => NUMERIC.has(field.type);

/** Значение для правки: дата приводится к виду, который понимает календарь. */
export function editValue(field: Field, raw: unknown): string {
  const text = raw === null || raw === undefined ? "" : String(raw);
  if (field.type !== "date" || !text) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dotted = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return dotted ? `${dotted[3]}-${dotted[2]}-${dotted[1]}` : text;
}

type EditorProps = {
  field: Field;
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  className?: string;
  id?: string;
};

/**
 * Контрол под тип колонки.
 *
 * Список показывается через `datalist`, а не `select`, и это выбор, а не
 * лень. Значения списка собраны из книги при импорте: в «Счёте» их 22, и
 * подсказать их надо. Но книгу ведут живые люди, и завтра появится
 * двадцать третий счёт; `select` в этот момент не даёт его ввести вовсе —
 * человек уходит обратно в Google Sheets, ровно туда, откуда мы его звали.
 */
export function FieldEditor({
  field,
  value,
  onChange,
  onKeyDown,
  onBlur,
  autoFocus,
  className,
  id,
}: EditorProps) {
  const common = {
    id,
    className,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange(event.target.value),
    onKeyDown,
    onBlur,
    autoFocus,
  };

  if (field.type === "bool") {
    return (
      <select {...common}>
        <option value="">—</option>
        <option value="ДА">да</option>
        <option value="НЕТ">нет</option>
      </select>
    );
  }

  if (field.type === "date") {
    return <input {...common} type="date" />;
  }

  if (NUMERIC.has(field.type)) {
    return <input {...common} inputMode="decimal" placeholder="0" />;
  }

  if (field.options.length > 0) {
    const listId = `opts-${field.key}`;
    return (
      <>
        <input {...common} list={listId} maxLength={500} autoComplete="off" />
        <datalist id={listId}>
          {field.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    );
  }

  return <input {...common} maxLength={500} />;
}
