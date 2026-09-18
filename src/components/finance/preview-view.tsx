"use client";

import { useState } from "react";

import {
  type Account,
  type ImportPreview,
  type ImportRow,
  financeApi,
  formatDate,
  formatMoney,
} from "@/components/finance/api";

/**
 * Предпросмотр разбора — общий для файла и для книги Google.
 *
 * Экран устроен вокруг одного решения: **источник не отвергается целиком.**
 * Поэтому здесь три вещи, которых нет у импортёров, что мы разбирали 17 сентября
 * 2026:
 *
 * 1. Сводка «готово / отложено / пропущено» вместо «загрузить не удалось».
 *    Двести строк с одной испорченной — это 199 готовых и одна отложенная.
 * 2. Замечание на строке называет поле и показывает, что стояло в ячейке.
 *    Отложенную строку правят здесь же, не перезагружая источник.
 * 3. Решения видны: какая строка признана шапкой, как прочитан порядок частей
 *    даты и чем это доказано, какие колонки не использованы. Если порядок из
 *    данных не выводится — раздел спрашивает, один раз, а не угадывает построчно.
 *
 * Общий компонент, а не две копии: книга из Google и скачанный файл обязаны
 * показывать одно и то же. Разъехавшись, они показывали бы разное число
 * отложенных строк на одних и тех же данных.
 */
export function PreviewView({
  preview,
  setPreview,
  accounts,
  reload,
  onApplied,
  onReset,
  resetLabel,
}: {
  preview: ImportPreview;
  setPreview: (next: ImportPreview) => void;
  accounts: Account[];
  /** Перечитать источник с ответом на вопрос раздела. */
  reload: (answer: { date_order?: string; default_account?: string }) => Promise<ImportPreview>;
  onApplied: () => void;
  onReset: () => void;
  resetLabel: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [showAll, setShowAll] = useState(false);

  const answer = async (patch: { date_order?: string; default_account?: string }) => {
    setBusy(true);
    setError("");
    try {
      setPreview(await reload(patch));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не прочиталось");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (lines?: number[]) => {
    setBusy(true);
    setError("");
    try {
      const done = await financeApi.applyBatch(preview.batch_id, lines ? { lines } : {});
      setResult(
        `Завели ${done.imported} ${plural(done.imported, "операцию", "операции", "операций")}` +
          (done.failed ? `, отложено ${done.failed}` : "") +
          (done.duplicate ? `, повторов ${done.duplicate}` : "") +
          (done.skipped ? `, пропущено ${done.skipped}` : ""),
      );
      const fresh = await financeApi.importBatch(preview.batch_id);
      setPreview({ ...preview, rows: fresh.rows as ImportRow[] });
      onApplied();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось завести операции");
    } finally {
      setBusy(false);
    }
  };

  const fixRow = async (line: number, patch: Record<string, unknown>) => {
    try {
      const fixed = await financeApi.fixImportRow(preview.batch_id, line, patch);
      setPreview({
        ...preview,
        rows: preview.rows.map((row) =>
          row.line === line
            ? { ...row, state: fixed.state as ImportRow["state"], problems: fixed.problems, values: fixed.values }
            : row,
        ),
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Правка не сохранилась");
    }
  };

  const failed = preview.rows.filter((row) => row.state === "failed");
  const ready = preview.rows.filter((row) => row.state === "imported");
  const skipped = preview.rows.filter((row) => row.state === "skipped" || row.state === "duplicate");

  return (
    <>
      {/* Вопрос задаётся один раз на источник — и только когда ответа в данных нет. */}
      {preview.question ? (
        <div className="fin-card p-4 flex flex-col gap-2" style={{ borderColor: "var(--accent-line)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {preview.question.title}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {preview.question.text}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {preview.question.options.map((option) => (
              <button
                key={option.value}
                type="button"
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() =>
                  void answer(
                    preview.question?.kind === "account"
                      ? { default_account: option.value }
                      : { date_order: option.value },
                  )
                }
              >
                {option.label}
                {option.example ? ` · ${option.example}` : ""}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Строк в источнике</span>
          <span className="fin-kpi-value">{preview.counts.total}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Готово завести</span>
          <span className="fin-kpi-value fin-in">{ready.length}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Отложено</span>
          <span className={`fin-kpi-value ${failed.length ? "fin-out" : ""}`}>{failed.length}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Пропущено</span>
          <span className="fin-kpi-value">{skipped.length}</span>
        </div>
      </div>

      <div className="fin-card p-3 text-xs flex flex-col gap-1.5" style={{ color: "var(--text-secondary)" }}>
        <p className="fin-label">Как прочитано</p>
        <p>
          {preview.file_name} · шапка — строка {preview.header_line} · даты{" "}
          {preview.date_order === "dmy" ? "день · месяц · год" : "месяц · день · год"}
          {preview.date_evidence ? `: ${preview.date_evidence}` : ""}
        </p>
        <p>
          Колонки:{" "}
          {Object.entries(preview.mapping.columns)
            .map(([key, value]) => `«${value.header}» → ${key}`)
            .join(", ")}
        </p>
        {preview.unused_columns.length ? (
          <p style={{ color: "var(--text-muted)" }}>Не использованы: {preview.unused_columns.join(", ")}</p>
        ) : null}
        {preview.rules_applied && Object.keys(preview.rules_applied).length ? (
          <p>
            Правила разметили:{" "}
            {Object.entries(preview.rules_applied)
              .map(([name, count]) => `«${name}» — ${count}`)
              .join(", ")}
          </p>
        ) : null}
        {preview.accounts_missing.length ? (
          <p className="fin-issue-text">Счетов нет в справочнике: {preview.accounts_missing.join(", ")}</p>
        ) : null}
      </div>

      {failed.length ? (
        <div className="fin-card">
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <p className="fin-label">Отложенные строки — что в них не сошлось</p>
          </div>
          <div>
            {failed.slice(0, showAll ? failed.length : 25).map((row) => (
              <FailedRow key={row.line} row={row} accounts={accounts} onFix={fixRow} />
            ))}
          </div>
          {failed.length > 25 && !showAll ? (
            <button type="button" className="btn-ghost m-3 text-xs" onClick={() => setShowAll(true)}>
              Показать все {failed.length}
            </button>
          ) : null}
        </div>
      ) : null}

      {skipped.length ? (
        <details className="fin-card p-3">
          <summary className="text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            Пропущенные строки — {skipped.length} (итоги, пустые, повторы)
          </summary>
          <div className="pt-2">
            {skipped.slice(0, 40).map((row) => (
              <div key={row.line} className="fin-row-issue">
                <span className="fin-issue-line">стр. {row.line}</span>
                <span className="fin-issue-skip">{row.problems.map((problem) => problem.text).join("; ")}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {ready.length ? (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Стр.</th>
                <th>Дата</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Вид</th>
                <th>Счёт</th>
                <th>Категория</th>
                <th>Контрагент</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {ready.slice(0, 50).map((row) => {
                const values = row.values as Record<string, string | null>;
                return (
                  <tr key={row.line}>
                    <td className="fin-num">{row.line}</td>
                    <td className="fin-strong">{values.paid_at ? formatDate(values.paid_at) : "—"}</td>
                    <td
                      className={`fin-num ${
                        values.kind === "income" ? "fin-in" : values.kind === "expense" ? "fin-out" : ""
                      }`}
                    >
                      {values.amount ? formatMoney(values.amount) : "—"}
                    </td>
                    <td>
                      {values.kind === "income"
                        ? "поступление"
                        : values.kind === "expense"
                          ? "списание"
                          : "перевод"}
                    </td>
                    <td>{values.account_to || values.account_from || "—"}</td>
                    <td>{values.category || "—"}</td>
                    <td>{values.counterparty || "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: "16rem" }}>{values.comment || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ready.length > 50 ? (
            <p className="text-xs p-3" style={{ color: "var(--text-muted)" }}>
              Показаны первые 50 строк из {ready.length}
            </p>
          ) : null}
        </div>
      ) : null}

      {result ? (
        <p className="text-sm" style={{ color: "var(--text-primary)" }}>
          {result}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy || !ready.length} onClick={() => apply()}>
          {busy ? "Заводим…" : `Завести ${ready.length} ${plural(ready.length, "операцию", "операции", "операций")}`}
        </button>
        <button type="button" className="btn-ghost" onClick={onReset}>
          {resetLabel}
        </button>
      </div>
    </>
  );
}

/**
 * Одна отложенная строка: чего не хватило и поле, чтобы это дописать.
 *
 * Правка идёт по той же строке источника, а не «загрузите исправленный файл»: в
 * книге на двести строк перезагрузка ради одной ячейки — это потеря места, на
 * котором человек остановился.
 */
function FailedRow({
  row,
  accounts,
  onFix,
}: {
  row: ImportRow;
  accounts: Account[];
  onFix: (line: number, patch: Record<string, unknown>) => void;
}) {
  const values = row.values as Record<string, string | null>;
  const fields = new Set(row.problems.map((problem) => problem.field));

  return (
    <div className="fin-row-issue">
      <span className="fin-issue-line">стр. {row.line}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="fin-issue-text">{row.problems.map((problem) => problem.text).join("; ")}</span>
        <span className="text-xs break-words" style={{ color: "var(--text-muted)" }}>
          {Object.entries(row.raw)
            .map(([key, value]) => `${key} = ${String(value)}`)
            .join(" · ") || "пусто"}
        </span>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {fields.has("paid_at") ? (
            <input
              type="date"
              className="input-field"
              style={{ width: "auto" }}
              defaultValue={values.paid_at ?? ""}
              onChange={(event) => onFix(row.line, { paid_at: event.target.value })}
            />
          ) : null}
          {fields.has("amount") ? (
            <input
              className="input-field fin-num"
              style={{ width: "8rem", textAlign: "left" }}
              placeholder="сумма"
              defaultValue={values.amount ?? ""}
              onBlur={(event) =>
                onFix(row.line, { amount: event.target.value.replace(/\s/g, "").replace(",", ".") })
              }
            />
          ) : null}
          {fields.has("kind") ? (
            <select
              className="input-field"
              style={{ width: "auto" }}
              defaultValue={values.kind ?? ""}
              onChange={(event) => onFix(row.line, { kind: event.target.value })}
            >
              <option value="">вид операции</option>
              <option value="income">поступление</option>
              <option value="expense">списание</option>
              <option value="transfer">перевод</option>
            </select>
          ) : null}
          {fields.has("account_from") || fields.has("account_to") ? (
            <select
              className="input-field"
              style={{ width: "auto" }}
              defaultValue=""
              onChange={(event) =>
                onFix(row.line, {
                  [values.kind === "income" ? "account_to" : "account_from"]: event.target.value,
                })
              }
            >
              <option value="">выберите счёт</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.name}>
                  {account.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
