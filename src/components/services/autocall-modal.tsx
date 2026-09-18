"use client";

import { useCallback, useEffect, useState } from "react";

import { CloseIcon, RefreshIcon } from "@/components/icons";
import { AutocallServiceIcon } from "@/components/service-icons";
import { useScrollLock } from "@/components/use-scroll-lock";

const API = "/api/backend";
/* Accent for autocall metrics — pulled from the design system's sapphire */
const ACCENT = "var(--accent)";

type LatestInfo = {
  name: string | null;
  date: string | null;
  final_cost: string | null;
  status: string | null;
};

type Metrics = {
  total_autocalls: number;
  eligible_count: number;
  pending_count: number;
  synced_count: number;
  total_cost: string;
  cutoff_date: string;
  latest: LatestInfo | null;
};

type SyncResult = {
  added: number;
  skipped: number;
  total_seen: number;
  last_date: string | null;
};

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { detail?: string; message?: string };
    return data.detail ?? data.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)" }}
    >
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="text-xl font-semibold" style={{ color: accent ?? "var(--text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

export function AutocallModal({ onClose }: { onClose: () => void }) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [topupSyncing, setTopupSyncing] = useState(false);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/autocall/metrics`);
      if (!res.ok) throw new Error(await readError(res));
      setMetrics((await res.json()) as Metrics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить метрики");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useScrollLock(true);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/autocall/sync`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as SyncResult;
      setSyncMsg(
        result.added > 0
          ? `Добавлено строк: ${result.added}. Пропущено (уже есть): ${result.skipped}.`
          : `Новых записей нет. Пропущено: ${result.skipped}.`,
      );
      await loadMetrics();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления таблицы");
    } finally {
      setSyncing(false);
    }
  };

  const handleTopupSync = async () => {
    setTopupSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const res = await fetch(`${API}/api/v1/autocall/topups/sync`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res));
      const result = (await res.json()) as SyncResult;
      setSyncMsg(
        result.added > 0
          ? `Операции: добавлено ${result.added}, пропущено (уже есть) ${result.skipped}.`
          : `Операции: новых нет. Всего записей: ${result.total_seen}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка обновления пополнений");
    } finally {
      setTopupSyncing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--page-bg)" }}
    >
      {/* Header. Верхний отступ считается от «чёлки»: модалка занимает экран
          целиком, включая зону выреза. */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3 border-b"
        style={{
          background: "var(--header-bg)",
          borderColor: "var(--border-subtle)",
          paddingTop: "calc(0.75rem + var(--safe-t))",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="logo-badge logo-badge-quiet">
            <AutocallServiceIcon size={18} />
          </span>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Autocall.kz
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleSync()}
            type="button"
            disabled={syncing}
            className="btn-primary text-sm"
            title="Подтянуть новые обзвоны из Autocall и дописать в Google Sheets"
          >
            <RefreshIcon size={15} className={syncing ? "animate-spin-slow" : undefined} />
            {syncing ? "Обновление…" : "Обновить таблицу"}
          </button>
          <button
            onClick={() => void handleTopupSync()}
            type="button"
            disabled={topupSyncing}
            className="btn-ghost text-sm"
            title="Подтянуть операции по балансу (пополнения, возвраты, расходы) на лист «Пополнения»"
          >
            <RefreshIcon size={15} className={topupSyncing ? "animate-spin-slow" : undefined} />
            {topupSyncing ? "Операции…" : "Обновить операции"}
          </button>
          <button
            onClick={onClose}
            type="button"
            className="btn-ghost px-2.5 py-2"
            title="Закрыть"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div
        className="flex-1 overflow-auto p-5 max-w-4xl w-full mx-auto space-y-5"
        style={{ paddingBottom: "max(1.25rem, var(--safe-b))" }}
      >
        {syncMsg && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "var(--accent-soft)", border: `1px solid ${ACCENT}`, color: "var(--text-primary)" }}
          >
            {syncMsg}
          </div>
        )}
        {error && (
          <div
            className="rounded-lg px-4 py-3 text-sm"
            style={{ background: "var(--bg-hover)", border: "1px solid #f43f5e", color: "#fda4af" }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Загрузка метрик…</p>
        ) : metrics ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Всего обзвонов" value={String(metrics.total_autocalls)} />
              <MetricCard label={`С ${metrics.cutoff_date}`} value={String(metrics.eligible_count)} />
              <MetricCard label="К заливке (новые)" value={String(metrics.pending_count)} accent={ACCENT} />
              <MetricCard label="Уже в таблице" value={String(metrics.synced_count)} />
            </div>

            <MetricCard label="Сумма (фактическая, с отсечки)" value={`${metrics.total_cost} ₸`} />

            {metrics.latest && (
              <div
                className="rounded-xl p-4 space-y-2"
                style={{ background: "var(--surface)", border: "1px solid var(--border-base)" }}
              >
                <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Последний обзвон
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Название</div>
                    <div style={{ color: "var(--text-primary)" }}>{metrics.latest.name ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Дата</div>
                    <div style={{ color: "var(--text-primary)" }}>{metrics.latest.date ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Фактическая стоимость</div>
                    <div style={{ color: "var(--text-primary)" }}>{metrics.latest.final_cost ?? "—"} ₸</div>
                  </div>
                  <div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Статус</div>
                    <div style={{ color: "var(--text-primary)" }}>{metrics.latest.status ?? "—"}</div>
                  </div>
                </div>
              </div>
            )}

            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              «Обновить таблицу» дописывает обзвоны, созданные с {metrics.cutoff_date} (формат: Дата | Проект | Сумма).
              «Обновить операции» дописывает движение по балансу на лист «Пополнения»
              (Дата и время | Пополнение | Возврат | Расход | Описание).
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
