"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

import { CloseIcon, UploadIcon } from "@/components/icons";

import { downloadGoogleSheet, sheetUrl, spreadsheetIdOf } from "./google-link";
import { openXlsx, type XlsxBook } from "./xlsx/read";
import type { ImportedSheet, SheetSummary } from "./xlsx/types";

export type ImportResult = {
  title: string;
  source: "google" | "file";
  sourceRef: string;
  sheets: ImportedSheet[];
};

type Props = {
  /** Название открытой таблицы — куда можно добавить листы. */
  openName: string;
  onClose: () => void;
  onDone: (result: ImportResult, target: "new" | "append") => void;
};

type Loaded = { book: XlsxBook; source: "google" | "file"; sourceRef: string; title: string };

/** Много листов — отмечаем только первый: всё сразу в большой книге никто не просил. */
const PRESELECT_ALL_UP_TO = 5;

function size(sheet: SheetSummary): string {
  if (!sheet.rows) return "пустой";
  return `${sheet.rows.toLocaleString("ru-RU")} × ${sheet.cols}`;
}

export function ImportPanel({ openName, onClose, onDone }: Props) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bookRef = useRef<XlsxBook | null>(null);

  // Поток разбора держит книгу в памяти, пока открыт этот диалог, — и ни секундой дольше.
  useEffect(() => () => bookRef.current?.close(), []);

  const accept = (next: Loaded) => {
    bookRef.current?.close();
    bookRef.current = next.book;
    const visible = next.book.sheets.filter((sheet) => !sheet.hidden);
    const initial = visible.length <= PRESELECT_ALL_UP_TO ? visible : visible.slice(0, 1);
    setPicked(new Set(initial.map((sheet) => sheet.name)));
    setLoaded(next);
  };

  const fromGoogle = async () => {
    const id = spreadsheetIdOf(link);
    if (!id) {
      setError("Это не ссылка на Google Таблицу");
      return;
    }
    setError(null);
    setBusy("Загружаем из Google…");
    try {
      const { buffer, title } = await downloadGoogleSheet(id);
      setBusy("Читаем таблицу…");
      const book = await openXlsx(buffer);
      accept({ book, source: "google", sourceRef: sheetUrl(id), title: title || book.title });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось загрузить таблицу");
    } finally {
      setBusy(null);
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Нужен файл .xlsx — так его сохраняют Excel и Google Таблицы");
      return;
    }
    setError(null);
    setBusy("Читаем файл…");
    try {
      const book = await openXlsx(await file.arrayBuffer());
      accept({ book, source: "file", sourceRef: file.name, title: file.name.replace(/\.xlsx$/i, "") });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Файл не читается");
    } finally {
      setBusy(null);
    }
  };

  const finish = async (target: "new" | "append") => {
    if (!loaded || !picked.size) return;
    setError(null);
    setBusy("Переносим листы…");
    try {
      // Порядок — как в книге, а не как ставили галочки.
      const names = loaded.book.sheets.map((sheet) => sheet.name).filter((name) => picked.has(name));
      const sheets = await loaded.book.convert(names);
      onDone({ title: loaded.title, source: loaded.source, sourceRef: loaded.sourceRef, sheets }, target);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось перенести листы");
    } finally {
      // Экран может спросить про несохранённые правки и получить «Отмена» —
      // тогда окно остаётся, и кнопки в нём обязаны снова работать.
      setBusy(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void fromFile(event.dataTransfer.files?.[0]);
  };

  const toggle = (name: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const allNames = loaded?.book.sheets.map((sheet) => sheet.name) ?? [];
  const allPicked = allNames.length > 0 && allNames.every((name) => picked.has(name));

  return (
    <div className="we-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="we-modal we-import"
        role="dialog"
        aria-modal="true"
        aria-label="Листы из Google или файла"
        data-dragging={dragging ? "true" : undefined}
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <header className="we-modal-head">
          <span className="we-modal-title">{loaded ? loaded.title : "Листы из Google или файла"}</span>
          <button type="button" className="we-icon-btn" onClick={onClose} disabled={Boolean(busy)} aria-label="Закрыть">
            <CloseIcon size={15} />
          </button>
        </header>

        {!loaded && (
          <div className="we-import-source">
            <form
              className="we-link-row"
              onSubmit={(event) => {
                event.preventDefault();
                void fromGoogle();
              }}
            >
              <input
                className="input-field"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="Ссылка на Google Таблицу"
                aria-label="Ссылка на Google Таблицу"
                autoFocus
                disabled={Boolean(busy)}
              />
              <button type="submit" className="we-primary" disabled={Boolean(busy) || !link.trim()}>
                Загрузить
              </button>
            </form>

            <div className="we-or" aria-hidden="true">
              <span>или</span>
            </div>

            <button
              type="button"
              className="we-file-drop"
              onClick={() => fileRef.current?.click()}
              disabled={Boolean(busy)}
            >
              <UploadIcon size={18} />
              <span>Файл .xlsx</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(event) => {
                void fromFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        )}

        {loaded && (
          <>
            <div className="we-tabs-bar">
              <span className="we-modal-note">
                Листов: {picked.size} из {allNames.length}
              </span>
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={Boolean(busy)}
                onClick={() => setPicked(allPicked ? new Set() : new Set(allNames))}
              >
                {allPicked ? "Снять все" : "Отметить все"}
              </button>
            </div>
            <div className="we-modal-body">
              {loaded.book.sheets.map((sheet) => (
                <label key={sheet.name} className="we-tab-row">
                  <input
                    type="checkbox"
                    checked={picked.has(sheet.name)}
                    onChange={() => toggle(sheet.name)}
                    disabled={Boolean(busy)}
                  />
                  <span className="we-source-name">{sheet.name}</span>
                  {sheet.hidden && <span className="we-source-meta">скрыт</span>}
                  <span className="we-source-meta we-num">{size(sheet)}</span>
                </label>
              ))}
            </div>
          </>
        )}

        {error && (
          <p className="we-modal-error" role="alert">
            {error}
          </p>
        )}

        <footer className="we-modal-foot">
          <span className="we-modal-note" role="status" aria-live="polite">
            {busy ?? ""}
          </span>
          {loaded && (
            <>
              <button
                type="button"
                className="btn-ghost btn-sm we-append"
                disabled={Boolean(busy) || !picked.size}
                onClick={() => void finish("append")}
                title={`Добавить листы в «${openName}»`}
              >
                В «{openName}»
              </button>
              <button
                type="button"
                className="we-primary"
                disabled={Boolean(busy) || !picked.size}
                onClick={() => void finish("new")}
              >
                Новой таблицей
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
