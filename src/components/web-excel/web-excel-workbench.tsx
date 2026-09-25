"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ArrowLeftIcon, BookIcon, UploadIcon } from "@/components/icons";
import { StageLink, useStageNavigate } from "@/components/motion/stage-transition";
import { UniverSheet, type UniverApi, type UniverSheetHandle, type WorkbookSnapshot } from "@/components/univer/sheet";

import { shelfApi, type ShelfItem, type TableSource } from "./api";
import { ImportPanel, type ImportResult } from "./import-panel";
import { ShelfPanel } from "./shelf-panel";
import { ensureSheetFonts } from "./sheet-fonts";
import { appendFromBook, appendImported, bookFromImport, fontsOf, sheetsOf, type PendingLists } from "./workbook";

/** Какая таблица была открыта последней — удобство одного браузера, не данные. */
const LAST_KEY = "tables.last-open";

type Doc = { id: number | null; name: string; source: TableSource; sourceRef: string };

const BLANK_DOC: Doc = { id: null, name: "Новая таблица", source: "blank", sourceRef: "" };

// Univer: CommandType.MUTATION и DataValidationRenderMode / ErrorStyle — числами.
const MUTATION = 2;
const RENDER_ARROW = 1;
const RENDER_CHIP = 2;
const ERROR_STOP = 1;
const ERROR_WARNING = 2;

/**
 * Мутации, которые Univer делает сам, без человека: пересчёт формул, подгон
 * высоты строк и `doc.mutation.*` — собственный документ редактора ячейки. Его
 * Univer заводит при открытии книги и меняет на каждую букву, пока значение ещё
 * не принято; сама правка листа приходит отдельной `sheet.*` после Enter.
 * Отметь мы их правкой — только что открытая таблица сразу говорила бы «не
 * сохранено» (так и было на первом прогоне).
 */
const SELF_MUTATIONS = /^doc\.|formula|auto-height|numfmt/i;

function readLast(): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeLast(id: number | null) {
  try {
    if (id) window.localStorage.setItem(LAST_KEY, String(id));
    else window.localStorage.removeItem(LAST_KEY);
  } catch {
    /* приватный режим — просто не помним */
  }
}

function message(exc: unknown, fallback: string): string {
  return exc instanceof Error && exc.message ? exc.message : fallback;
}

type Props = {
  /** Лист собран и нарисован — занавес перехода можно поднимать. */
  onShown?: () => void;
};

export function WebExcelWorkbench({ onShown }: Props) {
  const [workbook, setWorkbook] = useState<WorkbookSnapshot | null>(null);
  const [workbookKey, setWorkbookKey] = useState(0);
  const [doc, setDoc] = useState<Doc>(BLANK_DOC);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const [shelf, setShelf] = useState<ShelfItem[] | null>(null);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** Действие, которое ждёт решения о несохранённых правках. */
  const [pending, setPending] = useState<{ run: () => void } | null>(null);

  const sheetRef = useRef<UniverSheetHandle>(null);
  const apiRef = useRef<UniverApi>(null);
  const listsRef = useRef<PendingLists>({});
  const dirtyRef = useRef(false);
  const savedTimer = useRef<number | undefined>(undefined);
  const stageNavigate = useStageNavigate();

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
    if (value) setSaved(false);
  }, []);

  const refreshShelf = useCallback(async () => {
    try {
      setShelf(await shelfApi.list());
      setShelfError(null);
    } catch (exc) {
      setShelfError(message(exc, "Полка не загрузилась"));
      setShelf((current) => current ?? []);
    }
  }, []);

  /** Показать книгу: Univer пересоздаётся ключом, списки встанут в `onReady`. */
  const show = useCallback(
    (book: WorkbookSnapshot | null, next: Doc, lists: PendingLists = {}, isDirty = false) => {
      listsRef.current = lists;
      setWorkbook(book);
      setWorkbookKey((key) => key + 1);
      setDoc(next);
      markDirty(isDirty);
      setError(null);
    },
    [markDirty],
  );

  const openTable = useCallback(
    async (id: number) => {
      setNote("Открываем…");
      setError(null);
      try {
        const table = await shelfApi.open(id);
        // Шрифты — до того, как книга попадёт в Univer: он меряет ширины текста
        // при первой отрисовке, и опоздавший шрифт уже ничего не исправит.
        await ensureSheetFonts(fontsOf(table.snapshot));
        show(table.snapshot, { id: table.id, name: table.name, source: table.source, sourceRef: table.source_ref });
        writeLast(table.id);
        setShelfOpen(false);
        setNote(null);
      } catch (exc) {
        setNote(null);
        setError(message(exc, "Таблица не открылась"));
        if (readLast() === id) writeLast(null);
      }
    },
    [show],
  );

  // Первый заход: полка и последняя открытая таблица. Univer до этого не
  // монтируется, чтобы не собирать пустую книгу, которую тут же заменят.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let items: ShelfItem[] = [];
      try {
        items = await shelfApi.list();
        if (!cancelled) setShelf(items);
      } catch (exc) {
        if (!cancelled) {
          setShelfError(message(exc, "Полка не загрузилась"));
          setShelf([]);
        }
      }
      if (cancelled) return;
      const last = readLast();
      if (last && items.some((item) => item.id === last)) await openTable(last);
      else if (items.length) setShelfOpen(true);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [openTable]);

  /** Сделать, но сначала спросить про несохранённые правки. */
  const guarded = useCallback((run: () => void) => {
    if (dirtyRef.current) setPending({ run });
    else run();
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const snapshot = sheetRef.current?.snapshot();
    if (!snapshot) {
      setError("Таблица ещё не готова — попробуйте через секунду");
      return false;
    }
    const name = doc.name.trim() || "Без названия";
    snapshot.name = name;
    setSaving(true);
    setError(null);
    try {
      const payload = { name, sheets: sheetsOf(snapshot), snapshot };
      const stored = doc.id
        ? await shelfApi.save(doc.id, payload)
        : await shelfApi.create({ ...payload, source: doc.source, source_ref: doc.sourceRef });
      setDoc((current) => ({ ...current, id: stored.id, name: stored.name }));
      markDirty(false);
      writeLast(stored.id);
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      // «Сохранено» — след действия, а не вечная надпись: в покое строка молчит.
      savedTimer.current = window.setTimeout(() => setSaved(false), 3000);
      void refreshShelf();
      return true;
    } catch (exc) {
      setError(message(exc, "Не удалось сохранить"));
      return false;
    } finally {
      setSaving(false);
    }
  }, [doc, markDirty, refreshShelf]);

  // Ctrl/Cmd+S — как в любом редакторе. По коду клавиши: на русской раскладке это «ы».
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
        event.preventDefault();
        if (!saving) void save();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save, saving]);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  /** Univer готов: поставить списки импорта и начать замечать правки. */
  const onReady = useCallback(
    (api: UniverApi) => {
      apiRef.current = api;

      const lists = listsRef.current;
      listsRef.current = {};
      const sheets = api.getActiveWorkbook?.()?.getSheets?.() ?? [];
      const byId = new Map<string, UniverApi>(sheets.map((sheet: UniverApi) => [String(sheet.getSheetId?.() ?? ""), sheet]));
      // Списки ставятся через API, а не ресурсом снимка: состав списка Univer
      // хранит одной строкой через запятую, и «Аренда, коммуналка», собранная
      // руками, молча разъехалась бы на два пункта.
      void (async () => {
        for (const [sheetId, rules] of Object.entries(lists)) {
          const sheet = byId.get(sheetId);
          if (!sheet || typeof api.newDataValidation !== "function") continue;
          for (const rule of rules) {
            try {
              const options: Record<string, unknown> = {
                allowBlank: true,
                showErrorMessage: true,
                errorStyle: rule.strict ? ERROR_STOP : ERROR_WARNING,
                renderMode: RENDER_ARROW,
              };
              if (rule.prompt) Object.assign(options, { prompt: rule.prompt, showInputMessage: true });
              const built = api.newDataValidation().requireValueInList(rule.values, false, true).setOptions(options).build();
              for (const range of rule.ranges) {
                await sheet
                  .getRange(
                    range.startRow,
                    range.startColumn,
                    range.endRow - range.startRow + 1,
                    range.endColumn - range.startColumn + 1,
                  )
                  .setDataValidation(built);
              }
            } catch {
              // Список — удобство, а не условие открытия книги.
            }
          }
        }
      })();

      const listener = api.onCommandExecuted?.(
        (command: { id: string; type?: number }, options?: { onlyLocal?: boolean }) => {
          if (command.type !== MUTATION || options?.onlyLocal || SELF_MUTATIONS.test(command.id)) return;
          if (!dirtyRef.current) markDirty(true);
        },
      );
      return () => {
        listener?.dispose?.();
        apiRef.current = null;
      };
    },
    [markDirty],
  );

  // ── Вставка: список и флажок на выделение ─────────────────────────────────

  const selection = () => {
    const api = apiRef.current;
    const range = api?.getActiveWorkbook?.()?.getActiveSheet?.()?.getActiveRange?.();
    return api && range ? { api, range } : null;
  };

  const insertList = async () => {
    const target = selection();
    if (!target) return;
    try {
      const built = target.api
        .newDataValidation()
        .requireValueInList(["Вариант 1", "Вариант 2"], false, true)
        .setOptions({ allowBlank: true, showErrorMessage: true, errorStyle: ERROR_WARNING, renderMode: RENDER_CHIP })
        .build();
      await target.range.setDataValidation(built);
      // Сразу панель правила — там пункты, цвета, стиль показа и запрет ввода.
      await target.api.executeCommand("data-validation.operation.open-validation-panel", {
        ruleId: built.rule?.uid,
        isAdd: true,
      });
    } catch (exc) {
      setError(message(exc, "Список не встал на выделение"));
    }
  };

  const insertCheckbox = async () => {
    const target = selection();
    if (!target) return;
    try {
      await target.range.setDataValidation(target.api.newDataValidation().requireCheckbox().build());
    } catch (exc) {
      setError(message(exc, "Флажки не встали на выделение"));
    }
  };

  const openRules = () => {
    void apiRef.current?.executeCommand?.("data-validation.operation.open-validation-panel", {});
  };

  // ── Полка и импорт ────────────────────────────────────────────────────────

  const currentSnapshot = (): WorkbookSnapshot | null => sheetRef.current?.snapshot() ?? null;

  const onImportDone = async (result: ImportResult, target: "new" | "append") => {
    const fonts = new Set(result.sheets.flatMap((sheet) => sheet.fonts));
    await ensureSheetFonts([...fonts]);
    const frozen = result.sheets.reduce((sum, sheet) => sum + sheet.stats.frozenFormulas, 0);
    const cut = result.sheets.find((sheet) => sheet.stats.truncated);

    const apply = () => {
      if (target === "new") {
        const assembled = bookFromImport(result.title, result.sheets);
        show(assembled.workbook, { id: null, name: result.title, source: result.source, sourceRef: result.sourceRef }, assembled.lists, true);
        writeLast(null);
      } else {
        const current = currentSnapshot();
        if (!current) return;
        const assembled = appendImported(current, result.sheets);
        show(assembled.workbook, doc, assembled.lists, true);
      }
      setImportOpen(false);
      setShelfOpen(false);
      const parts = [`Листов перенесено: ${result.sheets.length}`];
      if (frozen) parts.push(`формул заменено значением: ${frozen}`);
      if (cut) parts.push(`«${cut.sheet.name}» обрезан до ${cut.stats.rows.toLocaleString("ru-RU")} строк`);
      setNote(parts.join(" · "));
    };
    if (target === "new") guarded(apply);
    else apply();
  };

  const onAddSheets = async (id: number, indexes: number[]) => {
    const source = await shelfApi.open(id);
    const order: string[] = source.snapshot.sheetOrder ?? Object.keys(source.snapshot.sheets ?? {});
    const ids = indexes.map((index) => order[index]).filter(Boolean);
    const current = currentSnapshot();
    if (!current || !ids.length) throw new Error("Лист не нашёлся в таблице");
    await ensureSheetFonts(fontsOf(source.snapshot));
    show(appendFromBook(current, source.snapshot, ids), doc, {}, true);
  };

  const onRename = async (id: number, name: string) => {
    const stored = await shelfApi.save(id, { name });
    if (id === doc.id) setDoc((current) => ({ ...current, name: stored.name }));
    await refreshShelf();
  };

  const onCopy = async (id: number) => {
    await shelfApi.copy(id);
    await refreshShelf();
  };

  const onDelete = async (id: number) => {
    await shelfApi.remove(id);
    if (id === doc.id) {
      // Открытая таблица осталась на экране, но на полке её больше нет:
      // следующее сохранение положит её заново, а не в пустоту.
      setDoc((current) => ({ ...current, id: null }));
      markDirty(true);
    }
    if (readLast() === id) writeLast(null);
    await refreshShelf();
  };

  const newTable = () =>
    guarded(() => {
      show(null, BLANK_DOC);
      writeLast(null);
      setShelfOpen(false);
      setNote(null);
    });

  const status = saving ? "Сохраняется…" : dirty ? "Не сохранено" : saved ? "Сохранено" : "";

  return (
    <div className="we-shell">
      <header className="we-bar">
        <StageLink
          href="/"
          label="Разделы"
          className="btn-ghost btn-sm"
          title="Разделы"
          onClick={(event) => {
            if (!dirtyRef.current) return;
            event.preventDefault();
            setPending({ run: () => stageNavigate("/", "Разделы") });
          }}
        >
          <ArrowLeftIcon size={15} />
          <span className="only-desktop-inline">Разделы</span>
        </StageLink>

        <input
          className="we-name"
          value={doc.name}
          onChange={(event) => {
            setDoc((current) => ({ ...current, name: event.target.value }));
            markDirty(true);
          }}
          placeholder="Название таблицы"
          aria-label="Название таблицы"
          maxLength={200}
        />

        {doc.source !== "blank" && doc.sourceRef && (
          <span className="we-origin only-desktop" title={doc.sourceRef}>
            {doc.source === "google" ? (
              <a href={doc.sourceRef} target="_blank" rel="noreferrer">
                из Google
              </a>
            ) : (
              `из ${doc.sourceRef}`
            )}
          </span>
        )}

        <div className="we-tools only-desktop" role="group" aria-label="Вставка">
          <button type="button" className="btn-ghost btn-sm" onClick={() => void insertList()} title="Выпадающий список на выделенные ячейки">
            Список
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => void insertCheckbox()} title="Флажки на выделенные ячейки">
            Флажок
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={openRules} title="Все правила проверки данных листа">
            Правила
          </button>
        </div>

        <div className="we-bar-right">
          <span className="we-status" role="status" aria-live="polite" data-dirty={dirty ? "true" : undefined}>
            {status}
          </span>
          {/* На телефоне импорт — из полки («Из Google или файла»): в шапке не
              хватает места под всё, а «Сохранить» и «Полка» важнее. */}
          <button
            type="button"
            className="btn-ghost btn-sm we-bar-btn only-desktop"
            onClick={() => setImportOpen(true)}
            title="Листы из Google или файла .xlsx"
          >
            <UploadIcon size={15} />
            <span className="only-desktop-inline">Импорт</span>
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm we-bar-btn"
            onClick={() => {
              void refreshShelf();
              setShelfOpen((open) => !open);
            }}
            aria-expanded={shelfOpen}
          >
            <BookIcon size={15} />
            <span>Полка</span>
            {shelf && shelf.length > 0 && <span className="we-shelf-count we-num">{shelf.length}</span>}
          </button>
          <button type="button" className="we-primary" disabled={saving || !ready} onClick={() => void save()}>
            Сохранить
          </button>
        </div>
      </header>

      {(error || note) && (
        <div className="we-note" data-error={error ? "true" : undefined} role={error ? "alert" : "status"}>
          {error ?? note}
        </div>
      )}

      <div className="we-grid">
        {ready ? (
          <UniverSheet key={workbookKey} ref={sheetRef} data={workbook} onReady={onReady} onShown={onShown} extras />
        ) : (
          <p className="we-grid-wait">Загружаем полку…</p>
        )}
      </div>

      {shelfOpen && (
        <ShelfPanel
          items={shelf}
          error={shelfError}
          currentId={doc.id}
          openName={doc.name}
          onClose={() => setShelfOpen(false)}
          onOpen={(id) => {
            if (id === doc.id) setShelfOpen(false);
            else guarded(() => void openTable(id));
          }}
          onNew={newTable}
          onImport={() => setImportOpen(true)}
          onRename={onRename}
          onCopy={onCopy}
          onDelete={onDelete}
          onAddSheets={onAddSheets}
        />
      )}

      {importOpen && (
        <ImportPanel
          openName={doc.name}
          onClose={() => setImportOpen(false)}
          onDone={(result, target) => void onImportDone(result, target)}
        />
      )}

      {pending && (
        <div className="we-modal-backdrop" onClick={() => setPending(null)}>
          <div className="we-modal we-confirm" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="we-modal-head">
              <span className="we-modal-title">В «{doc.name}» есть несохранённые правки</span>
            </header>
            <footer className="we-modal-foot">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setPending(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  const { run } = pending;
                  setPending(null);
                  markDirty(false);
                  run();
                }}
              >
                Не сохранять
              </button>
              <button
                type="button"
                className="we-primary"
                disabled={saving}
                onClick={() =>
                  void (async () => {
                    const { run } = pending;
                    if (await save()) {
                      setPending(null);
                      run();
                    }
                  })()
                }
              >
                Сохранить
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
