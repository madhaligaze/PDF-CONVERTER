"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Account,
  type ImportBatch,
  type ImportPreview,
  type ImportRow,
  financeApi,
  formatDate,
  formatMoney,
} from "@/components/finance/api";

type Props = {
  accounts: Account[];
  onChanged: () => void;
};

const STATE_TITLES: Record<ImportRow["state"], string> = {
  imported: "готово",
  failed: "отложено",
  skipped: "пропущено",
  duplicate: "уже есть",
};

/**
 * Загрузка выписки или книги.
 *
 * Экран устроен вокруг одного решения: **файл не отвергается целиком.** Поэтому
 * здесь три вещи, которых нет у импортёров, что мы разбирали 17 сентября 2026:
 *
 * 1. Сводка «готово / отложено / пропущено» вместо «загрузить не удалось».
 *    Двести строк с одной испорченной — это 199 готовых и одна отложенная, а не
 *    ноль.
 * 2. Замечание на строке называет поле и показывает, что именно стояло в
 *    ячейке. Отложенную строку правят здесь же и заводят, не перезагружая файл.
 * 3. Решения по файлу видны: какая строка признана шапкой, как прочитан порядок
 *    частей даты и чем это доказано, какие колонки не использованы. Если
 *    порядок дат из файла не выводится, раздел спрашивает — один раз на файл, а
 *    не угадывает в каждой строке.
 */
export function ImportPanel({ accounts, onChanged }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadBatches = useCallback(async () => {
    try {
      const next = await financeApi.importBatches();
      setBatches(next.items);
    } catch {
      /* прошлые загрузки — справка, без них экран работает */
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const send = async (next: File, dateOrder?: string) => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const parsed = await financeApi.importPreview(next, dateOrder ? { date_order: dateOrder } : {});
      setPreview(parsed);
      setFile(next);
    } catch (exc) {
      setPreview(null);
      setError(exc instanceof Error ? exc.message : "Файл не прочитался");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (lines?: number[]) => {
    if (!preview) return;
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
      onChanged();
      void loadBatches();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось завести операции");
    } finally {
      setBusy(false);
    }
  };

  const fixRow = async (line: number, patch: Record<string, unknown>) => {
    if (!preview) return;
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

  const failed = (preview?.rows ?? []).filter((row) => row.state === "failed");
  const ready = (preview?.rows ?? []).filter((row) => row.state === "imported");
  const skipped = (preview?.rows ?? []).filter((row) => row.state === "skipped" || row.state === "duplicate");

  return (
    <div className="flex flex-col gap-4">
      {!preview ? (
        <>
          <div
            className="fin-drop"
            data-over={over}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const dropped = event.dataTransfer.files?.[0];
              if (dropped) void send(dropped);
            }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {busy ? "Читаем файл…" : "Перетащите выписку или книгу"}
            </span>
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Excel (.xlsx) или CSV. Колонки ищем по названиям, поэтому порядок и лишние
              столбцы значения не имеют.
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Шапка отчёта над таблицей, строка «Итого» снизу и пустые строки внутри —
              не помеха.
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,.txt,.tsv"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) void send(picked);
              }}
            />
          </div>

          {accounts.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--accent-amber)" }}>
              Сначала заведите счета в «Справочниках»: импорт их не создаёт — место, где
              лежат деньги, не должно появляться из опечатки в выписке.
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Счета в файле сопоставляются с вашими по названию: {accounts.map((a) => a.name).join(", ")}.
              Категории, контрагенты, проекты и теги заведутся сами.
            </p>
          )}

          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}

          {batches.length ? (
            <div className="card p-3">
              <p className="eyebrow mb-2">Прошлые загрузки</p>
              <div className="flex flex-col">
                {batches.map((batch) => (
                  <div key={batch.id} className="fin-acc-row">
                    <span className="fin-acc-name" title={batch.file_name}>
                      {batch.file_name}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      завели {batch.rows_imported} из {batch.rows_total}
                      {batch.rows_failed ? `, отложено ${batch.rows_failed}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {/* Вопрос задаётся один раз на файл — и только когда ответа в данных нет. */}
          {preview.question ? (
            <div className="card p-4 flex flex-col gap-2" style={{ borderColor: "var(--accent-line)" }}>
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
                    onClick={() => file && void send(file, option.value)}
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
              <span className="eyebrow">Строк в файле</span>
              <span className="fin-kpi-value">{preview.counts.total}</span>
            </div>
            <div className="fin-kpi">
              <span className="eyebrow">Готово завести</span>
              <span className="fin-kpi-value fin-in">{ready.length}</span>
            </div>
            <div className="fin-kpi">
              <span className="eyebrow">Отложено</span>
              <span className={`fin-kpi-value ${failed.length ? "fin-out" : ""}`}>{failed.length}</span>
            </div>
            <div className="fin-kpi">
              <span className="eyebrow">Пропущено</span>
              <span className="fin-kpi-value">{skipped.length}</span>
            </div>
          </div>

          <div className="card p-3 text-xs flex flex-col gap-1.5" style={{ color: "var(--text-secondary)" }}>
            <p className="eyebrow">Как прочитан файл</p>
            <p>
              Шапка таблицы — строка {preview.header_line}. Даты прочитаны как{" "}
              {preview.date_order === "dmy" ? "день · месяц · год" : "месяц · день · год"}
              {preview.date_evidence ? `: ${preview.date_evidence}` : ""}.
            </p>
            <p>
              Колонки:{" "}
              {Object.entries(preview.mapping.columns)
                .map(([key, value]) => `«${value.header}» → ${key}`)
                .join(", ")}
              .
            </p>
            {preview.unused_columns.length ? (
              <p style={{ color: "var(--text-muted)" }}>
                Не использованы: {preview.unused_columns.join(", ")} — они остались в строке
                как есть и в учёт не попадут.
              </p>
            ) : null}
            {preview.accounts_missing.length ? (
              <p className="fin-issue-text">
                Счетов нет в справочнике: {preview.accounts_missing.join(", ")}. Заведите их или
                поправьте строки ниже.
              </p>
            ) : null}
          </div>

          {failed.length ? (
            <div className="card">
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="eyebrow">Отложенные строки — что в них не сошлось</p>
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
            <details className="card p-3">
              <summary className="text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                Пропущенные строки — {skipped.length} (итоги, пустые, повторы)
              </summary>
              <div className="pt-2">
                {skipped.slice(0, 40).map((row) => (
                  <div key={row.line} className="fin-row-issue">
                    <span className="fin-issue-line">стр. {row.line}</span>
                    <span className="fin-issue-skip">
                      {row.problems.map((problem) => problem.text).join("; ")}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {ready.length ? (
            <div className="card overflow-x-auto">
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
                  Показаны первые 50 строк из {ready.length}.
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
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setPreview(null);
                setFile(null);
                setResult("");
                setError("");
              }}
            >
              Другой файл
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Одна отложенная строка: чего не хватило и поле, чтобы это дописать.
 *
 * Правка идёт по той же строке файла, а не «загрузите исправленный файл»: в
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
        <span className="fin-issue-text">
          {row.problems.map((problem) => problem.text).join("; ")}
        </span>
        <span className="text-xs break-words" style={{ color: "var(--text-muted)" }}>
          В файле: {Object.entries(row.raw).map(([key, value]) => `${key} = ${String(value)}`).join(" · ") || "пусто"}
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
              onBlur={(event) => onFix(row.line, { amount: event.target.value.replace(/\s/g, "").replace(",", ".") })}
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

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
