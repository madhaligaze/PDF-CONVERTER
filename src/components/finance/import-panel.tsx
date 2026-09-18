"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Account,
  type ImportBatch,
  type ImportPreview,
  type ImportRow,
  financeApi,
} from "@/components/finance/api";
import { PreviewView } from "@/components/finance/preview-view";

type Props = {
  accounts: Account[];
  onChanged: () => void;
};

/**
 * Загрузка выписки или книги: выбор файла и прошлые загрузки.
 *
 * Разбор показывает `PreviewView` — тот же, что показывает вкладку книги
 * Google. Одно и то же обязано выглядеть одинаково, откуда бы ни пришли строки.
 */
export function ImportPanel({ accounts, onChanged }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
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

  /**
   * Отправить файл на разбор.
   *
   * Второй аргумент — ответ на вопрос раздела: либо порядок частей даты, либо
   * счёт, на который лягут операции выписки. Вопрос один на файл, поэтому и
   * ответ передаётся так же — повторной загрузкой с ответом, а не хранением
   * состояния на полпути.
   */
  /**
   * Открыть незавершённую загрузку и дать её дозавести.
   *
   * Перезагружать файл ради этого не надо: разбор уже сохранён партией, вместе
   * с решениями и замечаниями по строкам.
   */
  const resume = async (batch: ImportBatch) => {
    setBusy(true);
    setError("");
    try {
      const saved = await financeApi.importBatch(batch.id);
      const counts = saved.counts as Record<string, number>;
      setPreview({
        batch_id: saved.id,
        file_name: saved.file_name,
        header_line: 0,
        counts: {
          total: counts.total ?? 0,
          ready: counts.imported ?? 0,
          failed: counts.failed ?? 0,
          skipped: counts.skipped ?? 0,
        },
        question: null,
        date_order: String((saved.decisions as Record<string, unknown>)?.date_order ?? "dmy"),
        date_evidence: "",
        mapping: (saved.mapping as ImportPreview["mapping"]) ?? { columns: {}, width: 0 },
        unused_columns: [],
        accounts_missing: [],
        rows: saved.rows as ImportRow[],
      });
      setFile(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Загрузка не открылась");
    } finally {
      setBusy(false);
    }
  };

  const send = async (next: File, answer?: { date_order?: string; default_account?: string }) => {
    setBusy(true);
    setError("");
    try {
      const parsed = await financeApi.importPreview(next, answer ?? {});
      setPreview(parsed);
      setFile(next);
    } catch (exc) {
      setPreview(null);
      setError(exc instanceof Error ? exc.message : "Файл не прочитался");
    } finally {
      setBusy(false);
    }
  };

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
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              PDF · XLSX · CSV
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.xlsx,.xlsm,.csv,.txt,.tsv"
              className="hidden"
              onChange={(event) => {
                const picked = event.target.files?.[0];
                if (picked) void send(picked);
              }}
            />
          </div>

          {accounts.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--accent-amber)" }}>
              Сначала заведите счета в «Справочниках» — импорт их не создаёт.
            </p>
          ) : null}

          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}

          {batches.length ? (
            <div className="fin-card p-3">
              <p className="fin-label mb-2">Прошлые загрузки</p>
              <div className="flex flex-col">
                {batches.map((batch) => (
                  <div key={batch.id} className="fin-acc-row">
                    <span className="fin-acc-name" title={batch.file_name}>
                      {batch.file_name}
                    </span>
                    {/* Незавершённая загрузка — не «история», а брошенное дело:
                        строки разобраны, в учёте их нет. Её видно и её можно
                        доделать, не загружая файл заново. */}
                    {batch.status === "preview" ? (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        style={{ color: "var(--accent-amber)" }}
                        onClick={() => void resume(batch)}
                      >
                        разобрано {batch.rows_total}, не заведено — продолжить
                      </button>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        завели {batch.rows_imported} из {batch.rows_total}
                        {batch.rows_failed ? `, отложено ${batch.rows_failed}` : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <PreviewView
          preview={preview}
          setPreview={setPreview}
          accounts={accounts}
          reload={(answer) =>
            file
              ? financeApi.importPreview(file, answer)
              : // Партия, открытая из истории: файла на руках нет, и перечитывать
                // нечего — отдаём то, что уже разобрано и сохранено.
                financeApi.importBatch(preview.batch_id).then((saved) => ({
                  ...preview,
                  rows: saved.rows as ImportRow[],
                }))
          }
          onApplied={() => {
            onChanged();
            void loadBatches();
          }}
          onReset={() => {
            setPreview(null);
            setFile(null);
          }}
          resetLabel="Другой файл"
        />
      )}
    </div>
  );
}
