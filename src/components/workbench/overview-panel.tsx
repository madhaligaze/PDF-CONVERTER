import type { PreviewResponse } from "@/components/workbench/types";
import { formatPercent, formatValue } from "@/components/workbench/utils";

function InfoCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-inner p-4">
      <p
        className="text-[10px] uppercase tracking-widest font-medium"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </p>
      <p className="mt-2 text-base font-semibold leading-tight" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

export function OverviewPanel({ preview }: { preview: PreviewResponse | null }) {
  if (!preview) {
    return (
      <div className="card px-6 py-8 text-center">
        <p className="text-4xl mb-3" style={{ opacity: 0.18 }}>📊</p>
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Документ не загружен
        </p>
        <p className="mt-1 text-xs max-w-xs mx-auto" style={{ color: "var(--text-muted)" }}>
          Загрузите PDF, Excel или сканированное изображение выше и нажмите «Анализировать».
        </p>
      </div>
    );
  }

  const doc = preview.document;
  const totals = doc.totals;
  const netFlow = totals.income_total - totals.expense_total;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Document header */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="text-xs uppercase tracking-widest font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {doc.parser_key.replace(/_/g, " ")}
            </p>
            <h3 className="mt-1 text-xl font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {doc.title}
            </h3>
            {(doc.period_start || doc.period_end) && (
              <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {doc.period_start} — {doc.period_end}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {preview.parser_matches.slice(0, 2).map((m) => (
              <span key={m.key} className={`badge ${m.matched ? "badge-blue" : "badge-slate"}`}>
                {m.label} {Math.round(m.score * 100)}%
              </span>
            ))}
          </div>
        </div>

        {/* Applied OCR rule */}
        {preview.applied_rule && (
          <div className="mt-4 banner-emerald p-3 text-xs">
            <span className="font-semibold">Авто-сопоставление · </span>
            {preview.applied_rule.name} v{preview.applied_rule.version}
            {" · "}оценка {formatPercent(preview.applied_rule.score)}
            <span className="ml-2 opacity-70">({preview.applied_rule.reason})</span>
          </div>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <InfoCard label="Владелец счёта" value={doc.account_holder ?? "—"} />
        <InfoCard label="Транзакции" value={String(doc.transaction_count)} />
        <InfoCard
          label="Чистый поток"
          value={formatValue(netFlow, "currency")}
          sub={netFlow >= 0 ? "положительный" : "отрицательный"}
        />
        <InfoCard
          label="Уверенность"
          value={formatPercent(preview.quality_summary.overall_confidence)}
          sub={`${preview.quality_summary.high_risk_count} строк высокого риска`}
        />
      </div>

      {/* Totals */}
      <div className="grid gap-2 grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Доходы",     value: totals.income_total },
          { label: "Расходы",   value: totals.expense_total },
          { label: "Покупки",   value: totals.purchase_total },
          { label: "Переводы",  value: totals.transfer_total },
          { label: "Пополнения", value: totals.topup_total },
          { label: "Снятие",    value: totals.cash_withdrawal_total },
        ].map(({ label, value }) => (
          <div key={label} className="card-inner p-3 text-center">
            <p
              className="text-[9px] uppercase tracking-widest"
              style={{ color: "var(--text-muted)" }}
            >
              {label}
            </p>
            <p
              className="mt-1 text-xs sm:text-sm font-semibold font-mono"
              style={{ color: "var(--text-primary)" }}
            >
              {formatValue(value, "currency")}
            </p>
          </div>
        ))}
      </div>

      {/* Balances */}
      {(doc.opening_balance != null || doc.closing_balance != null) && (
        <div className="flex flex-wrap gap-2">
          {doc.opening_balance != null && (
            <div className="card-inner px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Открытие</span>
              <span className="text-sm font-semibold font-mono" style={{ color: "var(--text-primary)" }}>
                {formatValue(doc.opening_balance, "currency")}
              </span>
            </div>
          )}
          {doc.closing_balance != null && (
            <div className="card-inner px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Закрытие</span>
              <span className="text-sm font-semibold font-mono" style={{ color: "var(--text-primary)" }}>
                {formatValue(doc.closing_balance, "currency")}
              </span>
            </div>
          )}
          {preview.quality_summary.totals_mismatch && (
            <div className="banner-amber px-4 py-2.5 flex items-center gap-2">
              <span className="text-xs">⚠ Расхождение баланса</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
