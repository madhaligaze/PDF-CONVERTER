"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Account,
  type ImportBatch,
  type ImportPreview,
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
        <PreviewView
          preview={preview}
          setPreview={setPreview}
          accounts={accounts}
          reload={(answer) => financeApi.importPreview(file as File, answer)}
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
