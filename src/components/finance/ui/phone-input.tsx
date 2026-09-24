"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Телефон казахстанского мобильного: `+7 (7__) ___-__-__`.
 *
 * Номер — это логин сотрудника, поэтому поле ведёт себя как счётчик цифр, а
 * не как текст: цифра дописывается в конец, Backspace стирает последнюю
 * цифру (а не скобку или дефис), каретка всегда стоит после последней цифры.
 * «+7 » — неудаляемый префикс.
 *
 * Остаток маски — призрак под полем. Шрифт моноширинный, поэтому призрак
 * совпадает с набранным символ в символ, и маска «заполняется» по мере
 * набора, а не прыгает.
 *
 * «7» в маске — подсказка, а не набранная цифра. Люди набирают номер целиком,
 * с семёркой, и так же он приходит из автозаполнения; зашитая «7» превращала
 * бы «777…» в «7777…».
 *
 * Значение наружу — десять цифр после +7; `phoneValue` собирает `+77011234567`.
 */
const MASK = "+7 (7__) ___-__-__";
const PREFIX = "+7 ";

export function phoneValue(digits: string): string {
  return digits ? `+7${digits}` : "";
}

/** `+77011234567` → `+7 701 123 45 67` — номер в тексте, не в поле. */
export function formatPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const rest = digits.length === 11 ? digits.slice(1) : digits;
  if (rest.length !== 10) return phone ?? "";
  return `+7 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6, 8)} ${rest.slice(8)}`;
}

/** Десять цифр из того, что пришло: набора, вставки, автозаполнения. */
export function phoneDigits(raw: string): string {
  const text = raw.trim();
  let digits = text.startsWith("+7") ? text.slice(2).replace(/\D/g, "") : text.replace(/\D/g, "");
  // 11 цифр с 7 или 8 впереди — это номер с кодом страны.
  if (digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1);
  return digits.slice(0, 10);
}

function show(digits: string): string {
  if (!digits) return PREFIX;
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 8);
  const d = digits.slice(8, 10);
  let out = `+7 (${a}`;
  if (digits.length > 3) out += `) ${b}`;
  if (digits.length > 6) out += `-${c}`;
  if (digits.length > 8) out += `-${d}`;
  return out;
}

export const PHONE_NOT_MOBILE = "Номер мобильного в Казахстане начинается с +7 7";

type Props = {
  value: string;
  onChange: (digits: string) => void;
  id?: string;
  autoFocus?: boolean;
  /** Текст отказа снаружи (сервер); свой — «начинается с +7 7». */
  invalid?: boolean;
  onBlurCheck?: (message: string) => void;
  className?: string;
  "aria-describedby"?: string;
};

export function PhoneInput({
  value,
  onChange,
  id,
  autoFocus,
  invalid,
  onBlurCheck,
  className,
  "aria-describedby": describedBy,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [wrong, setWrong] = useState(false);
  const text = show(value);

  // Каретка — всегда после последней цифры, в том числе после отрисовки.
  useLayoutEffect(() => {
    const el = input.current;
    if (el && document.activeElement === el) el.setSelectionRange(text.length, text.length);
  }, [text]);

  const toEnd = () => {
    const el = input.current;
    if (!el) return;
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  return (
    <span className={`phone-input ${className ?? ""}`} data-invalid={invalid || wrong ? "true" : undefined}>
      <span className="phone-ghost" aria-hidden="true">
        <span className="phone-ghost-typed">{text}</span>
        {MASK.slice(text.length)}
      </span>
      <input
        ref={input}
        id={id}
        className="input-field phone-field"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus={autoFocus}
        value={text}
        aria-invalid={invalid || wrong ? true : undefined}
        aria-describedby={describedBy}
        onFocus={() => requestAnimationFrame(toEnd)}
        onClick={toEnd}
        onSelect={toEnd}
        onKeyDown={(event) => {
          if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            if (value) onChange(value.slice(0, -1));
            setWrong(false);
          }
        }}
        onChange={(event) => {
          const raw = event.target.value;
          const typed = raw.startsWith("+7") ? raw.slice(2).replace(/\D/g, "") : "";
          // Одна набранная цифра — дописать (одиннадцатую не берём); иначе это
          // вставка или автозаполнение, и номер разбирается целиком. Без этого
          // различия одиннадцатая набранная цифра превращала бы «7…» в номер
          // с кодом страны и съедала первую цифру.
          const next =
            typed.length === value.length + 1 && typed.startsWith(value)
              ? typed.slice(0, 10)
              : phoneDigits(raw);
          if (next !== value) onChange(next);
          if (wrong && (!next || next[0] === "7")) setWrong(false);
        }}
        onBlur={() => {
          const bad = value.length > 0 && value[0] !== "7";
          setWrong(bad);
          onBlurCheck?.(bad ? PHONE_NOT_MOBILE : "");
        }}
      />
    </span>
  );
}
