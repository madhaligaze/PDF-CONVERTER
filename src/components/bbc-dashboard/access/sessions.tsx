"use client";

/**
 * Открытые заходы в дашборд: с чего, когда и сколько.
 *
 * Зачем экран нужен
 * ─────────────────
 * Сессия теперь живёт долго и продлевается сама — заходить каждый день заново
 * не надо. У этого удобства есть цена: забытый заход на чужом компьютере тоже
 * живёт долго. Этот список и есть плата по счёту — единственное место, где
 * видно, откуда в учётку заходят, и единственная кнопка, которой чужой заход
 * обрывается.
 *
 * Кто что видит, решает сервер. Администратору сюда приезжают и заходы
 * сотрудников — заметить чужое устройство в учётке бухгалтера может только он.
 * Сотруднику приезжают только его собственные: список админских заходов — это
 * карта того, откуда и когда приходит человек с полным доступом.
 *
 * Почему без цветных отметок
 * ──────────────────────────
 * Соблазн подсветить «текущий» зелёным велик, и он же прямо запрещён правилами
 * проекта: цвет в этом продукте значит отказ. Свой заход отличается подписью и
 * тем, что его нельзя оборвать случайно, — а не точкой.
 */
import { useCallback, useEffect, useState } from "react";

import { BbcApiError, endSession, fetchSessions } from "../api";
import { LogoutIcon, UserIcon } from "../icon";
import type { BbcSession } from "../types";

/** «5 минут», «3 часа», «2 дня» — без «назад»: слово ставит вызывающий. */
function humanSpan(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "меньше минуты";
  if (minutes < 60) return `${minutes} ${plural(minutes, "минута", "минуты", "минут")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "час", "часа", "часов")}`;
  const days = Math.round(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ru-RU", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/**
 * Сколько человек просидел: от входа до последнего обращения.
 *
 * Не «сколько сессия ещё проживёт» и не «когда заходил». Вопрос, на который
 * отвечает эта строка, ровно один: заход был мимолётным или в учётке работали
 * полдня. Для чужого устройства это первое, что хочется знать.
 */
function sat(session: BbcSession): string {
  if (!session.created_at || !session.last_seen_at) return "";
  const ms = new Date(session.last_seen_at).getTime() - new Date(session.created_at).getTime();
  return ms < 60000 ? "меньше минуты" : humanSpan(ms);
}

export function Sessions({ isAdmin }: { isAdmin: boolean }) {
  const [sessions, setSessions] = useState<BbcSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirming, setConfirming] = useState("");

  const load = useCallback(async () => {
    try {
      setSessions((await fetchSessions()).sessions);
      setError("");
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось получить список заходов");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Загрузка на монтировании: состояние меняется только после await, так что
    // каскада отрисовок здесь нет.
    void load();
  }, [load]);

  async function end(session: BbcSession) {
    setBusy(session.id);
    try {
      await endSession(session.id);
      // Оборвали свой текущий заход — это выход. Перечитывать список незачем:
      // сервер уже убрал cookie, и следующий запрос вернул бы форму входа.
      if (session.current) {
        window.location.assign("/bbc-dashboard");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось завершить заход");
    } finally {
      setBusy("");
      setConfirming("");
    }
  }

  const mine = sessions.filter((session) => session.mine);
  const others = sessions.filter((session) => !session.mine);

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <UserIcon size={15} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Заходы в дашборд
        </h2>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
        {isAdmin
          ? "Ваши заходы и заходы сотрудников. Незнакомое устройство можно отключить — с него сразу попросят войти заново."
          : "Устройства, с которых открыт ваш дашборд. Незнакомое можно отключить — с него сразу попросят войти заново."}
      </p>

      {error && (
        <p className="text-xs mb-3" style={{ color: "var(--accent-rose)" }} role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mono-meta">Читаем заходы…</p>
      ) : sessions.length === 0 ? (
        <p className="mono-meta">Открытых заходов нет</p>
      ) : (
        <div className="bbc-sess">
          {mine.map((session) => (
            <Row
              key={session.id}
              session={session}
              showWho={false}
              busy={busy === session.id}
              confirming={confirming === session.id}
              onAsk={() => setConfirming(session.id)}
              onCancel={() => setConfirming("")}
              onEnd={() => end(session)}
            />
          ))}

          {others.length > 0 && (
            <p className="bbc-sess-split">Сотрудники</p>
          )}
          {others.map((session) => (
            <Row
              key={session.id}
              session={session}
              showWho
              busy={busy === session.id}
              confirming={confirming === session.id}
              onAsk={() => setConfirming(session.id)}
              onCancel={() => setConfirming("")}
              onEnd={() => end(session)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type RowProps = {
  session: BbcSession;
  /** Показывать, чей это заход. У своих не показываем — и так понятно. */
  showWho: boolean;
  busy: boolean;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onEnd: () => void;
};

function Row({ session, showWho, busy, confirming, onAsk, onCancel, onEnd }: RowProps) {
  const duration = sat(session);
  return (
    <article className="bbc-sess-row" data-current={session.current ? "" : undefined}>
      <div className="min-w-0">
        <h3 className="bbc-sess-device">
          {session.device}
          {session.current && <span className="bbc-sess-here">этот браузер</span>}
        </h3>
        <p className="bbc-sess-meta">
          {showWho && <b>{session.full_name || session.username}</b>}
          {session.ip && <span>{session.ip}</span>}
          {session.created_at && <span>вошли {when(session.created_at)}</span>}
          {duration && <span>просидели {duration}</span>}
          {session.last_seen_at && <span>последний запрос {when(session.last_seen_at)}</span>}
        </p>
      </div>

      {confirming ? (
        <span className="bbc-sess-ask">
          <button type="button" className="btn-ghost text-xs px-2.5 py-1.5" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn-primary text-xs px-2.5 py-1.5" onClick={onEnd} disabled={busy}>
            {busy ? "Завершаем…" : session.current ? "Выйти здесь" : "Точно отключить"}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5 shrink-0"
          onClick={onAsk}
          title={session.current ? "Это ваш текущий браузер" : "Отключить это устройство"}
        >
          <LogoutIcon size={14} />
          <span className="hidden sm:inline">{session.current ? "Выйти" : "Отключить"}</span>
        </button>
      )}
    </article>
  );
}
