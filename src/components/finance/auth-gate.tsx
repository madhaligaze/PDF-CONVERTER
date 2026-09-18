"use client";

import { useEffect, useState } from "react";

import { type Me, financeApi } from "@/components/finance/api";

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
    <div
      className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 py-10"
      style={{ background: "var(--page-bg)" }}
    >
      <div className="fin-card w-full max-w-md p-6 flex flex-col gap-4">
        <div>
          <p className="fin-label mb-1">Финансы</p>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
            {mode === "login" ? "Вход в учёт компании" : "Регистрация компании"}
          </h1>
        </div>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          {mode === "register" ? (
            <label className="flex flex-col gap-1">
              <span className="fin-label">Название компании</span>
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

          <label className="flex flex-col gap-1">
            <span className="fin-label">Почта</span>
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

          <label className="flex flex-col gap-1">
            <span className="fin-label">Пароль</span>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            {mode === "register" ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                От восьми символов.
              </span>
            ) : null}
          </label>

          {mode === "register" ? (
            <label className="flex flex-col gap-1">
              <span className="fin-label">Ваше имя (необязательно)</span>
              <input
                className="input-field"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>
          ) : null}

          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Минуту…" : mode === "login" ? "Войти" : "Зарегистрировать компанию"}
          </button>
        </form>

        <button
          type="button"
          className="btn-ghost text-xs self-start"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Регистрация компании" : "У меня уже есть учётная запись"}
        </button>
      </div>
    </div>
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
    <div
      className="min-h-screen min-h-[100dvh] flex items-center justify-center px-4 py-10"
      style={{ background: "var(--page-bg)" }}
    >
      <form className="fin-card w-full max-w-md p-6 flex flex-col gap-3" onSubmit={submit}>
        <p className="fin-label">Финансы</p>
        <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          Смените временный пароль
        </h1>
        <label className="flex flex-col gap-1">
          <span className="fin-label">Временный пароль</span>
          <input
            className="input-field"
            type="password"
            value={oldPassword}
            onChange={(event) => setOld(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="fin-label">Новый пароль</span>
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
          <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
      </form>
    </div>
  );
}

/** Пока не знаем, вошёл ли человек, показываем не пустоту, а ожидание. */
export function AuthLoading() {
  return (
    <div
      className="min-h-screen min-h-[100dvh] flex items-center justify-center"
      style={{ background: "var(--page-bg)", color: "var(--text-muted)" }}
    >
      <span className="text-sm">Проверяем доступ…</span>
    </div>
  );
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
