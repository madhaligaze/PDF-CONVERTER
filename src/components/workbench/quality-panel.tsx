"use client";

import { useWorkbench } from "@/components/workbench/context";
import type { QualitySummary, RowDiagnostic } from "@/components/workbench/types";
import { formatPercent, severityClassName } from "@/components/workbench/utils";

type Props = {
  summary: QualitySummary | null;
  diagnostics: RowDiagnostic[];
};

export function QualityPanel({ summary, diagnostics }: Props) {
  const {
    selectedDiagnosticRow, setSelectedDiagnosticRow,
    rowEditorDate, setRowEditorDate,
    rowEditorAmount, setRowEditorAmount,
    rowEditorOperation, setRowEditorOperation,
    rowEditorDetail, setRowEditorDetail,
    rowEditorDirection, setRowEditorDirection,
    rowEditorNote, setRowEditorNote,
    isSavingRowCorrection,
    handleSaveRowCorrection,
  } = useWorkbench();

  if (!summary) return null;

  // Цвет — только там, где что-то не так. Высокая уверенность зелёным не
  // горит: постоянный зелёный перестают замечать ровно к тому моменту, когда
  // он должен был насторожить (правило из CLAUDE.md).
  const conf = summary.overall_confidence;
  const confColor =
    conf >= 0.85 ? "var(--text-primary)" : conf >= 0.65 ? "var(--accent-amber)" : "var(--accent-rose)";
  const anomalyBar = Math.round(summary.anomaly_score * 100);

  return (
    <section className="card p-4 sm:p-5 animate-fade-in">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="headline" style={{ fontSize: "1.75rem" }}>
          Контроль качества
        </h2>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-normal tabular-nums" style={{ color: confColor, letterSpacing: "-0.04em" }}>
            {formatPercent(conf)}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>общий</span>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 mb-4">
        <Metric
          label="Проверка"
          value={summary.review_required_count}
          color={summary.review_required_count ? "var(--accent-amber)" : undefined}
        />
        <Metric
          label="Высокий риск"
          value={summary.high_risk_count}
          color={summary.high_risk_count ? "var(--accent-rose)" : undefined}
        />
        <Metric label="Исправлено" value={summary.corrected_count} />
        <Metric label="Чистые" value={summary.clean_count} />
      </div>

      {/* Anomaly bar */}
      {summary.anomaly_score > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>Индекс аномалий</p>
            <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>{anomalyBar}%</p>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-hover)" }}>
            {/* Графитовая, пока аномалий мало: низкий индекс — не повод красить. */}
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${anomalyBar}%`,
                background:
                  anomalyBar > 40 ? "var(--accent-rose)" : anomalyBar > 15 ? "var(--accent-amber)" : "var(--border-strong)",
              }}
            />
          </div>
        </div>
      )}

      {/* Totals mismatch */}
      {summary.totals_mismatch && (
        <div className="mb-4 banner-amber px-4 py-3 text-xs">
          Расхождение открытия/закрытия — проверьте чистый денежный поток.
        </div>
      )}

      {/* Recommendations */}
      {summary.recommendations.length > 0 && (
        <div className="mb-4 card-inner p-4">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Рекомендации
          </p>
          <ul className="space-y-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {summary.recommendations.map((r) => (
              <li key={r} className="flex gap-2">
                <span style={{ color: "var(--text-muted)" }} className="mt-0.5">›</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Row list */}
      <div className="space-y-2">
        {diagnostics.map((row) => (
          <div key={row.row_number}>
            <button
              className={`w-full text-left rounded-[var(--radius-inner)] border px-4 py-3 transition-colors ${
                selectedDiagnosticRow === row.row_number ? "" : ""
              }`}
              style={{
                background:
                  selectedDiagnosticRow === row.row_number
                    ? "var(--accent-soft)"
                    : "var(--bg-raised)",
                borderColor:
                  selectedDiagnosticRow === row.row_number
                    ? "var(--border-strong)"
                    : "var(--border-subtle)",
              }}
              onClick={() =>
                setSelectedDiagnosticRow(
                  selectedDiagnosticRow === row.row_number ? null : row.row_number,
                )
              }
              type="button"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                  <span className="mr-2" style={{ color: "var(--text-muted)" }}>#{row.row_number}</span>
                  {row.detail || row.operation}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>
                    {row.amount > 0 ? "+" : ""}
                    {row.amount.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}
                  </span>
                  <span className={`badge text-[0.62rem] ${
                    row.confidence >= 0.9 ? "badge-slate"
                    : row.confidence >= 0.7 ? "badge-amber"
                    : "badge-rose"
                  }`}>
                    {formatPercent(row.confidence)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {row.flags.length ? (
                  row.flags.map((flag) => (
                    <span
                      key={flag.code}
                      className={`badge text-[0.62rem] ${severityClassName(flag.severity)}`}
                    >
                      {flag.message}
                    </span>
                  ))
                ) : (
                  <span className="badge badge-slate text-[0.62rem]">Чистая</span>
                )}
              </div>
            </button>

            {/* Inline editor */}
            {selectedDiagnosticRow === row.row_number && (
              <div
                className="mt-1 ml-2 sm:ml-3 rounded-[var(--radius-inner)] border p-4 animate-slide-up"
                style={{
                  background: "var(--bg-raised)",
                  borderColor: "var(--border-base)",
                }}
              >
                <p className="text-xs font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
                  Редактировать строку {row.row_number}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <LabelInput label="Дата" value={rowEditorDate} onChange={setRowEditorDate} />
                  <LabelInput label="Сумма" value={rowEditorAmount} onChange={setRowEditorAmount} type="number" />
                  <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    Направление
                    <select
                      className="input-field mt-1"
                      value={rowEditorDirection}
                      onChange={(e) => setRowEditorDirection(e.target.value as "inflow" | "outflow")}
                    >
                      <option value="inflow">Приход</option>
                      <option value="outflow">Расход</option>
                    </select>
                  </label>
                  <LabelInput label="Операция" value={rowEditorOperation} onChange={setRowEditorOperation} />
                  <LabelInput label="Детали / Контрагент" value={rowEditorDetail} onChange={setRowEditorDetail} />
                  <LabelInput label="Примечание (необяз.)" value={rowEditorNote} onChange={setRowEditorNote} />
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn-primary text-xs"
                    disabled={isSavingRowCorrection}
                    onClick={handleSaveRowCorrection}
                    type="button"
                  >
                    {isSavingRowCorrection ? "Сохранение…" : "Сохранить исправление"}
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setSelectedDiagnosticRow(null)}
                    type="button"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Цвет у числа появляется, только когда оно не ноль и означает проблему. */
function Metric({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="card-inner p-3">
      <p className="eyebrow">{label}</p>
      <p
        className="mt-1 text-2xl tabular-nums"
        style={{ color: color ?? "var(--text-primary)", letterSpacing: "-0.04em" }}
      >
        {value}
      </p>
    </div>
  );
}

function LabelInput({
  label, value, onChange, type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
      {label}
      <input
        className="input-field mt-1"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
