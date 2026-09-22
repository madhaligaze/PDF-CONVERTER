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
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BbcApiError, fetchMe, logout } from "@/components/bbc-dashboard/api";
import { LoginScreen } from "@/components/bbc-dashboard/access/login-screen";
import { SetPasswordScreen } from "@/components/bbc-dashboard/access/set-password-screen";
import type { BbcMe } from "@/components/bbc-dashboard/types";
import { StageLink } from "@/components/motion/stage-transition";
import { AuthStage, AuthWait } from "@/components/stage/auth-stage";

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
    return <AuthWait>Проверяем доступ…</AuthWait>;
  }

  if (access.kind === "failed") {
    return (
      <Screen heading="Не удалось проверить доступ">
        <p className="auth-error" role="alert">
          {access.message}
        </p>
        <button type="button" className="btn-primary" onClick={() => void check()}>
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
        title="Таблицы"
        backHref="/"
        backLabel="Разделы"
      />
    );
  }

  if (!me.is_admin || me.link_label) {
    return (
      <Screen heading="Раздел закрыт">
        <p className="auth-note">«Таблицы» открыты только администраторам BBC.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => void signOut()}>
            Войти другой учётной записью
          </button>
          <StageLink className="btn-ghost" href="/" label="Разделы">
            На главную
          </StageLink>
        </div>
      </Screen>
    );
  }

  return <>{children}</>;
}

function Screen({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <AuthStage owner="BBC Consulting" title="Таблицы" backHref="/" backLabel="Разделы">
      <h2 className="auth-heading">{heading}</h2>
      <div className="auth-fields" role="status" aria-live="polite">
        {children}
      </div>
    </AuthStage>
  );
}
