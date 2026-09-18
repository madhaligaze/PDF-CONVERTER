"use client";

/**
 * Вход в «Таблицы» — той же учётной записью, что и дашборд BBC.
 *
 * Пока вход не прошёл, раздел выключен целиком: не грузится ни лист Univer, ни
 * один запрос к `/web-excel`. Сервер закрыт тоже (`app/api/router.py`), так
 * что этот экран — не единственная защита, а объяснение, почему закрыто.
 *
 * Пускается только администратор. В разделе лежат «Журнал» и реестр продаж с
 * ФОТ, а их дашборд сотрудникам не выдаёт — «Таблицы» не должны быть обходом.
 *
 * Вся связь с дашбордом — в этом файле. Снесут дашборд или «Таблицы» — править
 * придётся только его.
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BbcApiError, fetchMe, logout } from "@/components/bbc-dashboard/api";
import { LoginScreen } from "@/components/bbc-dashboard/access/login-screen";
import { SetPasswordScreen } from "@/components/bbc-dashboard/access/set-password-screen";
import type { BbcMe } from "@/components/bbc-dashboard/types";

type Access =
  | { kind: "checking" }
  | { kind: "failed"; message: string }
  | { kind: "known"; me: BbcMe };

export function TablesGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>({ kind: "checking" });

  const check = useCallback(async () => {
    setAccess({ kind: "checking" });
    try {
      setAccess({ kind: "known", me: await fetchMe() });
    } catch (err) {
      setAccess({
        kind: "failed",
        message: err instanceof BbcApiError ? err.message : "Не удалось проверить доступ",
      });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const signOut = async () => {
    try {
      await logout();
    } finally {
      await check();
    }
  };

  if (access.kind === "checking") {
    return <Screen title="Таблицы">Проверяем доступ…</Screen>;
  }

  if (access.kind === "failed") {
    return (
      <Screen title="Таблицы">
        <p role="alert">{access.message}</p>
        <button type="button" className="btn-primary mt-4 px-4 py-2.5" onClick={() => void check()}>
          Повторить
        </button>
      </Screen>
    );
  }

  const { me } = access;

  if (me.authenticated && me.must_change_password) {
    // Смена пароля гасит сессию — дальше обычный вход с новым паролем.
    return <SetPasswordScreen fullName={me.full_name ?? ""} onChanged={() => void check()} />;
  }

  if (!me.authenticated) {
    return (
      <LoginScreen
        needsSetup={me.needs_setup}
        onSignedIn={(signedIn) => setAccess({ kind: "known", me: signedIn })}
      />
    );
  }

  if (!me.is_admin || me.link_label) {
    return (
      <Screen title="Раздел закрыт">
        <p>«Таблицы» открыты только администраторам BBC.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button type="button" className="btn-primary px-4 py-2.5" onClick={() => void signOut()}>
            Войти другой учётной записью
          </button>
          <Link className="btn-ghost px-4 py-2.5" href="/">
            На главную
          </Link>
        </div>
      </Screen>
    );
  }

  return <>{children}</>;
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="min-h-screen min-h-[100dvh] flex items-center justify-center px-5"
      style={{ background: "var(--page-bg)" }}
    >
      <div className="card w-full max-w-sm p-7" role="status" aria-live="polite">
        <h1
          className="text-base font-semibold mb-3"
          style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
        >
          {title}
        </h1>
        <div className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
