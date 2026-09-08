"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Field, Row } from "@/components/books/api";
import { displayValue, editValue, FieldEditor, isNumeric } from "@/components/books/field-value";
import type { BookTable } from "@/components/books/use-book-table";
import { useFillHeight } from "@/components/books/use-fill-height";

/**
 * Таблица — книга такой, какая она есть.
 *
 * Что здесь важнее красоты
 * ────────────────────────
 * 1. **Порядок строк не меняется под руками.** Грид читает вкладку в порядке
 *    книги. Если бы он держал «свежие сверху», исправленная строка прыгала бы
 *    на первое место сразу после правки — человек правит одну ячейку и теряет
 *    место, где работал.
 *
 * 2. **Прокручивается таблица, а не страница.** У контейнера своя высота и своя
 *    полоса. Иначе 3634 строки растягивают страницу на семь тысяч пикселей,
 *    шапка с названиями колонок уезжает вверх, и на середине книги человек не
 *    знает, в какой он колонке. Это же требование записано в правилах проекта.
 *
 * 3. **В DOM только видимое.** 3634 строки × 24 колонки — это 87 тысяч ячеек;
 *    браузер их рисует, но перестаёт успевать за прокруткой. В разметке живёт
 *    окно из видимых строк плюс запас, остальное — высота распорки.
 *
 * 4. **Незагруженная строка выглядит незагруженной.** Страницы приезжают по
 *    мере прокрутки. Пустая строка вместо заглушки читалась бы как «в книге
 *    здесь пусто» — это разные вещи, и путать их нельзя.
 *
 * Правка идёт по одной ячейке: PATCH ровно того поля, которое тронули, с
 * версией строки. Соседние колонки в запрос не попадают, поэтому двое,
 * правящие разные колонки одной строки, друг друга не затирают.
 */

/** Высота строки. Прибита, потому что на ней стоит вся арифметика окна. */
const ROW_H = 30;
/** Сколько строк рисуем за пределами видимого — запас на быструю прокрутку. */
const OVERSCAN = 12;
const NUM_W = 56;

type Props = {
  data: BookTable;
  canWrite: boolean;
  /** Открыть строку карточкой — из таблицы тоже бывает нужно видеть всё сразу. */
  onOpenRecord: (row: Row) => void;
};

/** Ширина колонки: от типа, но не уже собственного заголовка. */
function widthOf(field: Field): number {
  const byType: Record<string, number> = {
    money: 124,
    number: 104,
    date: 108,
    bool: 76,
    enum: 200,
    text: 220,
    formula: 140,
    unknown: 120,
  };
  const base = byType[field.type] ?? 160;
  return Math.max(base, Math.min(320, field.title.length * 8 + 28));
}

export function GridView({ data, canWrite, onOpenRecord }: Props) {
  const { fields, rows, total, ensure } = data;

  // Таблица заканчивается там же, где окно: сколько бы панелей ни встало над
  // ней, вторая прокрутка не появляется.
  const { ref: scrollRef, height } = useFillHeight(240);
  const [top, setTop] = useState(0);
  /**
   * Что выделено. Выделение и правка разведены: выделять можно и без права писать.
   *
   * Курсор не хранится, а выводится. Добавленная запись обязана оказаться под
   * курсором — иначе человек её не найдёт в трёх с половиной тысячах строк, —
   * и напрашивается присвоить его эффектом после добавления. Присваивание
   * состояния в эффекте запускает лишний проход отрисовки; здесь свежая строка
   * просто перебивает ручное выделение, пока человек сам не сдвинет курсор.
   */
  const [picked, setPicked] = useState<{ r: number; c: number } | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; value: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const widths = useMemo(() => fields.map(widthOf), [fields]);
  const template = useMemo(
    () => `${NUM_W}px ${widths.map((w) => `${w}px`).join(" ")}`,
    [widths],
  );

  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(total, Math.ceil((top + height) / ROW_H) + OVERSCAN);

  useEffect(() => {
    if (total > 0) ensure(first, last);
  }, [first, last, total, ensure]);

  /** Довести глаз до строки — после добавления записи и при переходе стрелками. */
  const scrollToRow = useCallback(
    (index: number) => {
      const node = scrollRef.current;
      if (!node) return;
      const y = index * ROW_H;
      const view = node.clientHeight;
      if (y < node.scrollTop) node.scrollTo({ top: Math.max(0, y - ROW_H) });
      else if (y + ROW_H > node.scrollTop + view) {
        node.scrollTo({ top: y - view + ROW_H * 2 });
      }
    },
    [scrollRef],
  );

  // Через `useMemo` — иначе новый объект на каждой отрисовке пересоздавал бы
  // обработчики клавиатуры, а их пересоздание при прокрутке заметно на руках.
  const cursor = useMemo(
    () => (data.lastAdded !== null ? { r: data.lastAdded, c: 0 } : picked),
    [data.lastAdded, picked],
  );

  /** Сдвинуть курсор руками — и тем самым отпустить свежедобавленную строку. */
  const setCursor = useCallback(
    (next: { r: number; c: number } | null) => {
      data.forgetLastAdded();
      setPicked(next);
    },
    [data],
  );

  // Единственное, что делает этот эффект, — прокрутка. Это работа с DOM, а не
  // присваивание состояния, и в эффекте ей самое место.
  const fresh = data.lastAdded;
  useEffect(() => {
    if (fresh !== null) scrollToRow(fresh);
  }, [fresh, scrollToRow]);

  const commit = useCallback(async () => {
    if (!edit) return;
    const row = rows[edit.r];
    const field = fields[edit.c];
    setEdit(null);
    if (!row || !field) return;
    if (editValue(field, row.values?.[field.key]) === edit.value) return;
    setSaving(row.id);
    await data.patch(row, { [field.key]: edit.value });
    setSaving(null);
  }, [edit, rows, fields, data]);

  const beginEdit = useCallback(
    (r: number, c: number, seed?: string) => {
      if (!canWrite) return;
      const row = rows[r];
      const field = fields[c];
      if (!row || !field) return;
      setEdit({
        r,
        c,
        value: seed ?? editValue(field, row.values?.[field.key]),
      });
    },
    [canWrite, rows, fields],
  );

  const move = useCallback(
    (dr: number, dc: number) => {
      if (!cursor) {
        setCursor({ r: 0, c: 0 });
        return;
      }
      const r = Math.max(0, Math.min(total - 1, cursor.r + dr));
      const c = Math.max(0, Math.min(fields.length - 1, cursor.c + dc));
      if (dr) scrollToRow(r);
      setCursor({ r, c });
    },
    [cursor, setCursor, total, fields.length, scrollToRow],
  );

  /**
   * Клавиатура на всей решётке, а не на каждой ячейке.
   *
   * Ячеек в окне под сотню, и вешать обработчик на каждую — это сотня
   * подписок, пересоздаваемых на каждую прокрутку. Здесь один обработчик и
   * один источник правды о том, где курсор.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (edit) return; // пока правим — клавиши принадлежат полю ввода
      if (!cursor) return;
      const { key } = event;

      if (key === "ArrowDown") { event.preventDefault(); move(1, 0); return; }
      if (key === "ArrowUp") { event.preventDefault(); move(-1, 0); return; }
      if (key === "ArrowRight") { event.preventDefault(); move(0, 1); return; }
      if (key === "ArrowLeft") { event.preventDefault(); move(0, -1); return; }
      if (key === "Tab") { event.preventDefault(); move(0, event.shiftKey ? -1 : 1); return; }
      if (key === "PageDown") {
        event.preventDefault();
        move(Math.floor(height / ROW_H), 0);
        return;
      }
      if (key === "PageUp") {
        event.preventDefault();
        move(-Math.floor(height / ROW_H), 0);
        return;
      }
      if (key === "Enter") {
        event.preventDefault();
        beginEdit(cursor.r, cursor.c);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        // Очистка ячейки — это правка пустой строкой, а не пропуск поля.
        // Пока формы отбрасывали пустое значение, стереть ошибочную сумму
        // было нечем: значение оставалось в книге при любом сохранении.
        if (!canWrite) return;
        event.preventDefault();
        const row = rows[cursor.r];
        const field = fields[cursor.c];
        if (row && field && String(row.values?.[field.key] ?? "") !== "") {
          data.patch(row, { [field.key]: "" });
        }
        return;
      }
      // Печатаемый символ начинает правку с него — как в любой таблице.
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        beginEdit(cursor.r, cursor.c, key);
      }
    },
    [edit, cursor, move, beginEdit, height, canWrite, rows, fields, data],
  );

  const visible: number[] = [];
  for (let index = first; index < last; index += 1) visible.push(index);

  return (
    <div
      className="bbc-grid"
      role="grid"
      aria-rowcount={total}
      tabIndex={0}
      onKeyDown={onKeyDown}
      ref={scrollRef}
      style={{ height }}
      onScroll={(event) => setTop((event.target as HTMLDivElement).scrollTop)}
    >
      <div className="bbc-grid-inner" style={{ width: NUM_W + widths.reduce((a, b) => a + b, 0) }}>
        <div className="bbc-grid-head" style={{ gridTemplateColumns: template }} role="row">
          <div className="bbc-grid-num bbc-grid-hcell" role="columnheader" />
          {fields.map((field) => (
            <div key={field.key} className="bbc-grid-hcell" role="columnheader" title={field.title}>
              {field.title}
            </div>
          ))}
        </div>

        <div className="bbc-grid-body" style={{ height: total * ROW_H }}>
          {visible.map((index) => {
            const row = rows[index];
            return (
              <div
                key={row?.id ?? `slot-${index}`}
                className="bbc-grid-row"
                role="row"
                aria-rowindex={index + 1}
                style={{ transform: `translateY(${index * ROW_H}px)`, gridTemplateColumns: template }}
                data-pending={row ? undefined : ""}
                data-saving={row && saving === row.id ? "" : undefined}
              >
                <button
                  type="button"
                  className="bbc-grid-num"
                  tabIndex={-1}
                  title={row ? "Открыть карточкой" : undefined}
                  onClick={() => row && onOpenRecord(row)}
                >
                  {index + 1}
                </button>

                {fields.map((field, c) => {
                  const editing = edit && edit.r === index && edit.c === c;
                  const selected = cursor?.r === index && cursor?.c === c;
                  const raw = row?.values?.[field.key];
                  return (
                    <div
                      key={field.key}
                      role="gridcell"
                      className="bbc-grid-cell"
                      data-num={isNumeric(field) ? "" : undefined}
                      data-on={selected ? "" : undefined}
                      data-edit={editing ? "" : undefined}
                      onMouseDown={() => {
                        if (editing) return;
                        setCursor({ r: index, c });
                        if (edit) commit();
                      }}
                      onDoubleClick={() => beginEdit(index, c)}
                      title={row ? displayValue(field, raw) : undefined}
                    >
                      {editing ? (
                        <FieldEditor
                          field={field}
                          value={edit.value}
                          autoFocus
                          className="bbc-grid-input"
                          onChange={(next) => setEdit({ r: index, c, value: next })}
                          onBlur={commit}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEdit(null);
                              return;
                            }
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commit();
                              move(1, 0);
                              return;
                            }
                            if (event.key === "Tab") {
                              event.preventDefault();
                              commit();
                              move(0, event.shiftKey ? -1 : 1);
                            }
                          }}
                        />
                      ) : row ? (
                        displayValue(field, raw)
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
