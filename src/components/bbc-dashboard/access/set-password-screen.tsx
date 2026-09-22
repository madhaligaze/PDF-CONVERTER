"use client";

/**
 * Принудительная смена пароля при первом входе.
 *
 * Показывается вместо дашборда, пока `me.must_change_password`. Это не только
 * оформление: у такой учётки область видимости пуста, и за этим экраном данных
 * всё равно нет — сервер их не отдаст.
 *
 * Смысл в том, что временный пароль приезжает человеку в WhatsApp и остаётся
 * там навсегда. Пока он не сменён, «войти под Даной» может любой, кто пролистал
 * её переписку.
 */
import { useState, type FormEvent } from "react";

import { AuthStage } from "@/components/stage/auth-stage";

import { BbcApiError, setOwnPassword } from "../api";

const MIN_LENGTH = 8;

export function SetPasswordScreen({
  fullName,
  onChanged,
}: {
  fullName: string;
  /** Пароль сменён — сессия погашена, оболочка возвращает форму входа. */
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Проверка на совпадение — на клиенте: сервер второго поля не видит и не
  // должен, а гонять запрос ради опечатки в подтверждении незачем.
  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      await setOwnPassword(current, next);
      onChanged();
    } catch (err) {
      setError(
        err instanceof BbcApiError ? err.message : "Не удалось сменить пароль. Попробуйте ещё раз.",
      );
      setBusy(false);
    }
  }

  return (
    <AuthStage owner="BBC Consulting" title={fullName || "Первый вход"}>
      <h2 className="auth-heading">Задайте свой пароль</h2>

      {/* Предупреждение о закрытом состоянии — не дежурное пояснение: без
          него экран читается как «ещё одна форма», а не как «дальше не пустят». */}
      <p className="auth-note">
        Тот, что вам передали, знает не только вы — он остался в переписке. Пока он не сменён,
        дашборд закрыт.
      </p>

      <form onSubmit={submit} className="auth-fields">
        <label className="auth-field">
          <span className="eyebrow">Пароль, который вам выдали</span>
          <input
            className="input-field"
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>

        <label className="auth-field">
          <span className="eyebrow">Новый пароль</span>
          <input
            className="input-field"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
          />
          <span className="auth-hint" style={tooShort ? { color: "var(--accent-rose)" } : undefined}>
            Не короче {MIN_LENGTH} символов
          </span>
        </label>

        <label className="auth-field">
          <span className="eyebrow">Ещё раз</span>
          <input
            className="input-field"
            type="password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
          />
          {mismatch ? (
            <span className="auth-hint" style={{ color: "var(--accent-rose)" }}>
              Пароли не совпадают
            </span>
          ) : null}
        </label>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={busy || mismatch || tooShort || !next}>
          {busy ? "Сохраняем…" : "Сменить пароль"}
        </button>
      </form>

      <p className="auth-hint">После смены нужно будет войти заново — с новым паролем.</p>
    </AuthStage>
  );
}
