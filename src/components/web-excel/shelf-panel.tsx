"use client";

import { useState } from "react";

import { ChevronRightIcon, CloseIcon } from "@/components/icons";

import type { ShelfItem } from "./api";

type Props = {
  items: ShelfItem[] | null;
  error: string | null;
  currentId: number | null;
  /** Название открытой таблицы — куда добавляются листы с полки. */
  openName: string;
  onClose: () => void;
  onOpen: (id: number) => void;
  onNew: () => void;
  onImport: () => void;
  onRename: (id: number, name: string) => Promise<void>;
  onCopy: (id: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  /** Листы таблицы полки (по порядку в ней) — копией в открытую таблицу. */
  onAddSheets: (id: number, sheetIndexes: number[]) => Promise<void>;
};

const SOURCE: Record<string, string> = { google: "Google", file: "файл" };

function sheetsWord(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return "листов";
  if (n % 10 === 1) return "лист";
  if (n % 10 >= 2 && n % 10 <= 4) return "листа";
  return "листов";
}

const WHEN = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function meta(item: ShelfItem): string {
  const parts = [`${item.sheets.length} ${sheetsWord(item.sheets.length)}`];
  if (SOURCE[item.source]) parts.push(SOURCE[item.source]);
  if (item.updated_at) parts.push(WHEN.format(new Date(item.updated_at)));
  return parts.join(" · ");
}

export function ShelfPanel(props: Props) {
  const { items, error, currentId, openName, onClose, onOpen, onNew, onImport } = props;
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <>
      <div className="we-shelf-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="we-shelf" role="dialog" aria-label="Полка">
        <header className="we-shelf-head">
          <span className="we-shelf-title">Полка</span>
          {items && items.length > 0 && <span className="we-shelf-count we-num">{items.length}</span>}
          <button type="button" className="we-icon-btn" onClick={onClose} aria-label="Закрыть полку">
            <CloseIcon size={15} />
          </button>
        </header>

        <div className="we-shelf-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={onNew}>
            Новая таблица
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={onImport}>
            Из Google или файла
          </button>
        </div>

        {error && (
          <p className="we-modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="we-shelf-list">
          {items === null && !error && <p className="we-modal-note we-shelf-empty">Загружаем полку…</p>}
          {items?.length === 0 && <p className="we-modal-note we-shelf-empty">Пока пусто</p>}
          {items?.map((item) => (
            <ShelfRow
              {...props}
              key={item.id}
              item={item}
              current={item.id === currentId}
              open={expanded === item.id}
              openName={openName}
              onToggle={() => setExpanded((id) => (id === item.id ? null : item.id))}
              openItem={() => onOpen(item.id)}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

type RowProps = Props & {
  item: ShelfItem;
  current: boolean;
  open: boolean;
  onToggle: () => void;
  openItem: () => void;
};

function ShelfRow({ item, current, open, openName, onToggle, openItem, onRename, onCopy, onDelete, onAddSheets }: RowProps) {
  const [mode, setMode] = useState<"idle" | "rename" | "delete">("idle");
  const [draft, setDraft] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      setMode("idle");
    } catch (exc) {
      setFailure(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="we-shelf-item" data-current={current ? "true" : undefined} data-open={open ? "true" : undefined}>
      <div className="we-shelf-line">
        <button type="button" className="we-shelf-main" onClick={openItem} title={`Открыть «${item.name}»`}>
          <span className="we-shelf-name">{item.name}</span>
          <span className="we-shelf-meta">
            {meta(item)}
            {current ? " · открыта" : ""}
          </span>
        </button>
        <button
          type="button"
          className="we-icon-btn we-shelf-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Свернуть" : "Листы и действия"}
        >
          <ChevronRightIcon size={15} />
        </button>
      </div>

      {open && (
        <div className="we-shelf-more">
          <ul className="we-shelf-sheets">
            {item.sheets.map((sheet, index) => (
              <li key={`${sheet.name}-${index}`}>
                <span className="we-source-name">{sheet.name}</span>
                <span className="we-source-meta we-num">
                  {sheet.rows ? `${sheet.rows.toLocaleString("ru-RU")} × ${sheet.cols}` : "пустой"}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={busy || added.has(index)}
                  title={`Добавить копию листа в «${openName}»`}
                  onClick={() =>
                    void run(async () => {
                      await onAddSheets(item.id, [index]);
                      setAdded((set) => new Set(set).add(index));
                    })
                  }
                >
                  {added.has(index) ? "Добавлен" : "В открытую"}
                </button>
              </li>
            ))}
          </ul>

          {mode === "rename" && (
            <form
              className="we-link-row"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() => onRename(item.id, draft));
              }}
            >
              <input
                className="input-field"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Новое название"
                maxLength={200}
                autoFocus
              />
              <button type="submit" className="we-primary" disabled={busy || !draft.trim()}>
                Сохранить
              </button>
            </form>
          )}

          {mode === "delete" && (
            <div className="we-shelf-confirm" role="alert">
              <span>Удалить «{item.name}» с полки?</span>
              <button type="button" className="we-danger" disabled={busy} onClick={() => void run(() => onDelete(item.id))}>
                Удалить
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => setMode("idle")}>
                Отмена
              </button>
            </div>
          )}

          {mode === "idle" && (
            <div className="we-shelf-buttons">
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setDraft(item.name);
                  setMode("rename");
                }}
              >
                Переименовать
              </button>
              <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => onCopy(item.id))}>
                Копия
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMode("delete")}>
                Удалить
              </button>
            </div>
          )}

          {failure && (
            <p className="we-modal-error" role="alert">
              {failure}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
