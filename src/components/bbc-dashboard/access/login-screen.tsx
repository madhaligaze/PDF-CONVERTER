"use client";

/**
 * Sign-in gate for the dashboard.
 *
 * Shown whenever `/bbc/me` reports nobody is authenticated. When no admin exists
 * yet the copy switches to first-run guidance instead of pretending a password
 * would work.
 *
 * Оформление — общая афиша входа (`AuthStage`): она ничего не знает о дашборде,
 * дашборд передаёт ей надписи и форму.
 */
import { useState, type FormEvent } from "react";

import { AuthStage } from "@/components/stage/auth-stage";

import { BbcApiError, login } from "../api";
import type { BbcMe } from "../types";

type Props = {
  needsSetup: boolean;
  /** The visitor arrived with a link token that no longer works. */
  linkExpired?: boolean;
  /** Получает ответ входа, чтобы оболочка убрала экран без второго запроса. */
  onSignedIn: (me: BbcMe) => void;
};

export function LoginScreen({ needsSetup, linkExpired = false, onSignedIn }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(username, password);
      // busy НЕ сбрасываем: экран сейчас сменится, а мигание кнопки обратно в
      // «Войти» читается как «клик не сработал» — человек жмёт второй раз.
      onSignedIn(me);
    } catch (err) {
      setError(
        err instanceof BbcApiError ? err.message : "Не удалось войти. Попробуйте ещё раз.",
      );
      setBusy(false);
    }
  }

  return (
    <AuthStage owner="BBC Consulting" title="Управленческий отчёт" backHref="/services" backLabel="Сервисы">
      <h2 className="auth-heading">Вход</h2>

      {linkExpired ? (
        <div className="auth-error" role="status">
          Ссылка больше не действует — доступ отозван или истёк срок. Запросите новую у
          администратора или войдите под своей учётной записью.
        </div>
      ) : null}

      {needsSetup ? (
        <p className="auth-note">
          Учётная запись ещё не создана. Задайте <code>BBC_BOOTSTRAP_ADMIN</code> и{" "}
          <code>BBC_BOOTSTRAP_PASSWORD</code> в окружении бэкенда и перезапустите его — первый
          администратор создастся автоматически.
        </p>
      ) : null}

      <form onSubmit={submit} className="auth-fields">
        <label className="auth-field">
          <span className="eyebrow">Логин</span>
          <input
            className="input-field"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="auth-field">
          <span className="eyebrow">Пароль</span>
          <input
            className="input-field"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </AuthStage>
  );
}
