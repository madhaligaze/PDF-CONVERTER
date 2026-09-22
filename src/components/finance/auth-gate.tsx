"use client";

import { useEffect, useState } from "react";

import { type Me, financeApi } from "@/components/finance/api";
import { AuthStage, AuthWait } from "@/components/stage/auth-stage";

/**
 * Вход и регистрация раздела «Финансы».
 *
 * Раздел живёт сам по себе: компания регистрируется здесь, а не выдаётся
 * администратором дашборда. Поэтому первый экран — не «введите логин», а выбор
 * между «войти» и «зарегистрировать компанию», и второе стоит не мельче
 * первого: пока компаний мало, регистрация — главное действие экрана.
 *
 * Ошибку показываем текстом сервера, а не своим «что-то пошло не так»: сервер
 * различает «неверная почта или пароль», «пароль короче восьми символов» и
 * «почта уже зарегистрирована», и каждое из трёх говорит человеку, что делать.
 */
export function AuthGate({ onReady }: { onReady: (me: Me) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const me =
        mode === "login"
          ? await financeApi.login({ email, password })
          : await financeApi.register({ email, password, company, full_name: fullName });
      onReady(me);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStage owner="Финансы" title="Учёт денег компании" backHref="/services" backLabel="Сервисы">
      <h2 className="auth-heading">{mode === "login" ? "Вход в учёт компании" : "Регистрация компании"}</h2>

      <form className="auth-fields" onSubmit={submit}>
        {mode === "register" ? (
          <label className="auth-field">
            <span className="eyebrow">Название компании</span>
            <input
              className="input-field"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="ТОО «Компания»"
              autoComplete="organization"
              required
            />
          </label>
        ) : null}

        <label className="auth-field">
          <span className="eyebrow">Почта</span>
          <input
            className="input-field"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="buh@company.kz"
            autoComplete="email"
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
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
          />
          {mode === "register" ? <span className="auth-hint">От восьми символов.</span> : null}
        </label>

        {mode === "register" ? (
          <label className="auth-field">
            <span className="eyebrow">Ваше имя (необязательно)</span>
            <input
              className="input-field"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
            />
          </label>
        ) : null}

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? "Минуту…" : mode === "login" ? "Войти" : "Зарегистрировать компанию"}
        </button>
      </form>

      <button
        type="button"
        className="btn-ghost auth-switch"
        onClick={() => {
          setMode(mode === "login" ? "register" : "login");
          setError("");
        }}
      >
        {mode === "login" ? "Регистрация компании" : "У меня уже есть учётная запись"}
      </button>
    </AuthStage>
  );
}

/**
 * Экран смены временного пароля.
 *
 * Стоит между входом и разделом: пока пароль временный, сервер отказывает во
 * всём, кроме чтения и самой смены. Показывать вместо этого раздел, в котором
 * ничего не сохраняется, — худший из вариантов.
 */
export function PasswordChangeGate({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi.changePassword({ old_password: oldPassword, new_password: newPassword });
      onDone();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStage owner="Финансы" title="Учёт денег компании">
      <h2 className="auth-heading">Смените временный пароль</h2>
      <form className="auth-fields" onSubmit={submit}>
        <label className="auth-field">
          <span className="eyebrow">Временный пароль</span>
          <input
            className="input-field"
            type="password"
            value={oldPassword}
            onChange={(event) => setOld(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="auth-field">
          <span className="eyebrow">Новый пароль</span>
          <input
            className="input-field"
            type="password"
            value={newPassword}
            onChange={(event) => setNew(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
      </form>
    </AuthStage>
  );
}

/**
 * Пока не знаем, вошёл ли человек, показываем не пустоту, а ожидание.
 *
 * Не афишей: следом почти всегда идёт форма входа, и афиша, собранная дважды
 * за полсекунды (сначала здесь, потом в форме), читалась бы как рывок.
 * Подпись проявляется с задержкой — при обычной проверке её не видно вовсе.
 */
export function AuthLoading() {
  return <AuthWait>Проверяем доступ…</AuthWait>;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await financeApi.me();
        if (alive) setMe(next.authenticated ? next : null);
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { me, setMe, loading };
}
