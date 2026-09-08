"use client";

/**
 * Личный кабинет.
 *
 * Раньше страница целиком была админской и не-админу отвечала «доступно только
 * администратору». Теперь она разделена по разделам: заходы в дашборд —
 * личная безопасность, и она нужна каждому, у кого есть учётка; смена
 * реквизитов, сотрудники и ссылки отделов остались за администратором.
 *
 * Смена пароля завершает все сессии, включая текущую, — экран говорит об этом
 * заранее, а не роняет человека без предупреждения.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

import { ArrowLeftIcon } from "@/components/icons";
import { BbcApiError, changeCredentials, fetchLinks, fetchMe, logout } from "../api";
import { BbcDashboardIcon, LogoutIcon, UserIcon } from "../icon";
import { DepartmentLinks } from "./department-links";
import { Employees } from "./employees";
import { LoginScreen } from "./login-screen";
import { Sessions } from "./sessions";
import type { BbcLink, BbcMe } from "../types";

/**
 * Личность держим в модуле, а не только в состоянии компонента.
 *
 * Кабинет — соседняя страница дашборда, куда заходят и возвращаются. Без кэша
 * каждый заход начинался с пустого экрана «Загрузка…» на время round-trip до
 * бэкенда, хотя ответ был известен секунду назад.
 */
let cachedMe: BbcMe | null = null;

/**
 * Загрузка кабинета: личность и ссылки одним заходом.
 *
 * Раньше `/links` уходил только после ответа `/me` — просто потому, что список
 * рисовался вложенным компонентом и до его монтирования дело не доходило. Две
 * последовательные ходки до бэкенда на странице из двух карточек и давали
 * ощущение, что кабинет «долго грузится». Право на список всё равно проверяет
 * сервер, так что спросить оба сразу ничего не стоит: не-админ получит на
 * второй запрос 401, и ответ ему просто не понадобится.
 */
function useAccount() {
  const [me, setMe] = useState<BbcMe | null>(cachedMe);
  const [links, setLinks] = useState<BbcLink[]>([]);
  const [loading, setLoading] = useState(!cachedMe);
  const [linksLoading, setLinksLoading] = useState(true);

  const load = useCallback(async () => {
    const [identity, linkList] = await Promise.allSettled([fetchMe(), fetchLinks()]);

    if (identity.status === "fulfilled") {
      cachedMe = identity.value;
      setMe(identity.value);
    } else {
      cachedMe = null;
      setMe(null);
    }
    if (linkList.status === "fulfilled") setLinks(linkList.value);

    setLoading(false);
    setLinksLoading(false);
  }, []);

  useEffect(() => {
    // Загрузка на монтировании. Состояние меняется только после await, то есть
    // каскада рендеров тут нет — правило же считает подозрительным любой
    // setState внутри эффекта и этот случай отличить не умеет.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { me, links, loading, linksLoading, reload: load };
}

export function AccountClient() {
  const { me, links, loading, linksLoading, reload } = useAccount();

  if (loading) {
    return (
      <div className="min-h-screen min-h-[100dvh] flex items-center justify-center" style={{ background: "var(--page-bg)" }}>
        <p className="mono-meta">Загрузка…</p>
      </div>
    );
  }

  if (!me?.authenticated) {
    return <LoginScreen needsSetup={me?.needs_setup ?? false} onSignedIn={reload} />;
  }

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col" style={{ background: "var(--page-bg)" }}>
      <header
        className="sticky top-0 z-40 flex items-center justify-between gap-2 px-4 py-2.5 border-b backdrop-blur-md"
        style={{ background: "var(--header-bg)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2.5">
          <Link
            href="/bbc-dashboard"
            className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
            title="К дашборду"
          >
            <ArrowLeftIcon size={15} />
            <span className="hidden sm:inline">Назад</span>
          </Link>
          <span className="logo-badge">
            <BbcDashboardIcon size={16} />
          </span>
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}
          >
            Личный кабинет
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="mono-meta hidden sm:inline">{me.username}</span>
          <button
            type="button"
            className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5"
            onClick={async () => {
              await logout();
              await reload();
            }}
          >
            <LogoutIcon size={15} />
            <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>
      </header>

      {/*
        Кабинет перестал быть админской страницей, но не стал общей: каждый
        раздел показывается тому, чей он.

        Заходы — единственное, что видит здесь сотрудник, и это ровно то, что
        ему и полагается: список устройств, с которых открыт ЕГО дашборд, и
        кнопка отключить незнакомое. Смена логина и пароля, учётки и ссылки
        отделов остались за администратором — их эндпоинты как были админскими,
        так и остались, и показывать сотруднику форму, которая ответит 401,
        значило бы врать интерфейсом.
      */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-5 py-8 flex flex-col gap-5">
        {me.is_admin && <CredentialsCard onChanged={reload} />}
        <Sessions isAdmin={me.is_admin} />
        {me.is_admin && <Employees />}
        {me.is_admin && <DepartmentLinks initialLinks={links} loading={linksLoading} />}
      </main>
    </div>
  );
}

function CredentialsCard({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await changeCredentials({
        current_password: currentPassword,
        new_username: newUsername || undefined,
        new_password: newPassword || undefined,
      });
      setMessage({ text: result.detail ?? "Данные обновлены", ok: true });
      setCurrentPassword("");
      setNewUsername("");
      setNewPassword("");
      onChanged();
    } catch (err) {
      setMessage({
        text: err instanceof BbcApiError ? err.message : "Не удалось сохранить",
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <UserIcon size={15} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Логин и пароль
        </h2>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
        Заполните только то, что меняете. Смена пароля завершит все сессии, включая текущую.
      </p>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Текущий пароль</span>
          <input
            className="input-field"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Новый логин</span>
          <input
            className="input-field"
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            autoComplete="username"
            placeholder="не меняем"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Новый пароль</span>
          <input
            className="input-field"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="не меняем"
          />
        </label>

        <div className="sm:col-span-3 flex items-center gap-3 flex-wrap">
          <button type="submit" className="btn-primary text-xs px-4 py-2" disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
          {message ? (
            <span
              className="text-xs"
              style={{ color: message.ok ? "var(--accent-emerald)" : "var(--accent-rose)" }}
              role="status"
            >
              {message.text}
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
