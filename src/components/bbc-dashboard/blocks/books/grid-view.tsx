"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
/**
 * Метка «сохраняем» для черновой строки.
 *
 * У неё ещё нет идентификатора — он появится вместе со строкой в базе, — а
 * состояние «сохраняем» одно на всю таблицу и хранит именно его. Столкнуться
 * с настоящим нельзя: те приходят с сервера как UUID.
 */
const DRAFT = "draft";

type Props = {
  data: BookTable;
  canWrite: boolean;
  /**
   * Можно ли дописывать строки. Ложь во время поиска: дописать строку в
   * отфильтрованный список нельзя честно — она либо не подойдёт под запрос и
   * тут же исчезнет с глаз, либо подойдёт случайно и встанет не туда.
   */
  canAppend: boolean;
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

export function GridView({ data, canWrite, canAppend, onOpenRecord }: Props) {
  const { fields, rows, total, ensure } = data;

  /**
   * Пустая строка в конце книги — то, как в таблицах заводят записи.
   *
   * Кнопки «Добавить запись» в этом виде нет намеренно. Человек, пришедший
   * сюда за таблицей, добавляет строку так же, как делал это двадцать лет:
   * доезжает до низа и печатает. Модальное окно на этом месте — это просьба
   * бросить таблицу и заполнить анкету, то есть ровно то, из-за чего он
   * вернётся в Google Sheets.
   *
   * Строка заводится в базе на первой же заполненной ячейке, а не после того,
   * как заполнят всю. Так ведёт себя таблица: значение, которое вы напечатали
   * и подтвердили, уже сохранено. Курсор при этом остаётся на месте, и Tab
   * ведёт дальше по той же — уже настоящей — строке.
   */
  const draftable = canWrite && canAppend;
  /** Индекс черновой строки. Он же — число строк, когда её нет. */
  const draftAt = total;
  const rowCount = total + (draftable ? 1 : 0);

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
  const last = Math.min(rowCount, Math.ceil((top + height) / ROW_H) + OVERSCAN);

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

  /**
   * Защёлка от повторного подтверждения одной и той же правки.
   *
   * Подтверждение снимает поле ввода и возвращает фокус решётке, а снятие
   * фокуса само зовёт подтверждение. Без защёлки второй вызов приходил бы с
   * тем же состоянием правки и в пустой строке заводил вторую запись: человек
   * нажал Enter один раз, а строк появилось две.
   */
  const busy = useRef(false);

  /**
   * Подтвердить правку и встать туда, куда просили.
   *
   * `step` — куда уйти курсору: вниз по Enter, вбок по Tab, никуда при потере
   * фокуса. Шаг приходит сюда, а не выполняется вызывающим отдельным `move`,
   * из-за пустой строки: запись в ней сохраняется с ответом сервера, и `move`,
   * выполненный до ответа, перебивался бы установкой курсора после.
   *
   * Фокус возвращается решётке всегда. Поле ввода при подтверждении исчезает,
   * и вместе с ним фокус уходил в никуда: клавиатура переставала работать до
   * следующего щелчка мышью. В таблице, которую заполняют с клавиатуры, это
   * означает, что заполнить её с клавиатуры нельзя.
   */
  const commit = useCallback(
    async (step?: { dr: number; dc: number }) => {
      if (!edit || busy.current) return;
      busy.current = true;
      try {
        const field = fields[edit.c];
        const { r, c, value } = edit;
        setEdit(null);
        scrollRef.current?.focus();
        if (!field) return;

        /** Куда встать курсору: от строки `at`, но не ниже `limit`. */
        const land = (at: number, limit: number) => {
          if (!step) return { r: at, c };
          const next = {
            r: Math.max(0, Math.min(limit, at + step.dr)),
            c: Math.max(0, Math.min(fields.length - 1, c + step.dc)),
          };
          if (step.dr) scrollToRow(next.r);
          return next;
        };

        if (r === draftAt) {
          // Пустую ячейку пустой строки записью не считаем: провести по ней
          // курсор насквозь человек может и просто осматриваясь.
          if (!value) {
            setCursor(land(r, rowCount - 1));
            return;
          }
          setSaving(DRAFT);
          const saved = await data.create({ [field.key]: value });
          setSaving(null);
          // Строка под курсором только что стала настоящей, и ниже неё
          // появилась новая пустая — потолок вырос на единицу. `setCursor`
          // заодно снимает отметку «только что добавлена», иначе курсор увело
          // бы к ней эффектом.
          setCursor(saved ? land(r, r + 1) : { r, c });
          return;
        }

        setCursor(land(r, rowCount - 1));
        const row = rows[r];
        if (!row) return;
        if (editValue(field, row.values?.[field.key]) === value) return;
        setSaving(row.id);
        await data.patch(row, { [field.key]: value });
        setSaving(null);
      } finally {
        busy.current = false;
      }
    },
    [edit, rows, fields, data, draftAt, rowCount, setCursor, scrollRef, scrollToRow],
  );

  const beginEdit = useCallback(
    (r: number, c: number, seed?: string) => {
      if (!canWrite) return;
      const field = fields[c];
      if (!field) return;
      if (r === draftAt) {
        if (!draftable) return;
        setEdit({ r, c, value: seed ?? "" });
        return;
      }
      const row = rows[r];
      if (!row) return;
      setEdit({
        r,
        c,
        value: seed ?? editValue(field, row.values?.[field.key]),
      });
    },
    [canWrite, rows, fields, draftAt, draftable],
  );

  const move = useCallback(
    (dr: number, dc: number) => {
      if (!cursor) {
        setCursor({ r: 0, c: 0 });
        return;
      }
      const r = Math.max(0, Math.min(rowCount - 1, cursor.r + dr));
      const c = Math.max(0, Math.min(fields.length - 1, cursor.c + dc));
      if (dr) scrollToRow(r);
      setCursor({ r, c });
    },
    [cursor, setCursor, rowCount, fields.length, scrollToRow],
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
      // Ctrl+End и Ctrl+Home — то же, что в любой таблице. Здесь у них есть и
      // второе назначение: End доводит до пустой строки в конце книги, а иначе
      // до неё пришлось бы листать три с половиной тысячи строк колесом.
      if ((key === "End" || key === "Home") && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const r = key === "End" ? rowCount - 1 : 0;
        scrollToRow(r);
        setCursor({ r, c: cursor.c });
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
        if (!canWrite || cursor.r === draftAt) return;
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
    [edit, cursor, move, beginEdit, height, canWrite, rows, fields, data, draftAt, rowCount, scrollToRow, setCursor],
  );

  const visible: number[] = [];
  for (let index = first; index < last; index += 1) visible.push(index);

  return (
    <div
      className="bbc-grid"
      role="grid"
      aria-rowcount={rowCount}
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

        <div className="bbc-grid-body" style={{ height: rowCount * ROW_H }}>
          {visible.map((index) => {
            const draft = index === draftAt;
            const row = draft ? undefined : rows[index];
            return (
              <div
                key={draft ? "draft" : row?.id ?? `slot-${index}`}
                className="bbc-grid-row"
                role="row"
                aria-rowindex={index + 1}
                style={{ transform: `translateY(${index * ROW_H}px)`, gridTemplateColumns: template }}
                // Незагруженная строка выглядит незагруженной, черновая —
                // пустой. Это разные вещи: первая значит «данные едут», вторая
                // «здесь можно печатать», и одинаковой заглушки им хватать не
                // должно.
                data-pending={!draft && !row ? "" : undefined}
                data-draft={draft ? "" : undefined}
                data-saving={
                  (draft ? saving === DRAFT : row && saving === row.id) ? "" : undefined
                }
              >
                <button
                  type="button"
                  className="bbc-grid-num"
                  tabIndex={-1}
                  title={
                    draft ? "Новая строка: печатайте прямо здесь" : row ? "Открыть карточкой" : undefined
                  }
                  onClick={() => row && onOpenRecord(row)}
                >
                  {draft ? "+" : index + 1}
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
                          // Без обёртки сюда уходило бы событие потери фокуса
                          // как аргумент «куда шагнуть», и Tab переставал
                          // двигать курсор: подтверждение по Enter или Tab
                          // снимает поле ввода, поле теряет фокус, и второй
                          // вызов затирал только что выбранную клетку.
                          onBlur={() => commit()}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              setEdit(null);
                              // Фокус обязан вернуться решётке и здесь, иначе
                              // отменивший правку теряет клавиатуру.
                              scrollRef.current?.focus();
                              return;
                            }
                            // Шаг уходит в `commit`, а не выполняется отдельным
                            // `move` следом: в пустой строке сохранение ждёт
                            // ответа сервера, и курсор, сдвинутый до ответа,
                            // возвращался бы на место после него.
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commit({ dr: 1, dc: 0 });
                              return;
                            }
                            if (event.key === "Tab") {
                              event.preventDefault();
                              commit({ dr: 0, dc: event.shiftKey ? -1 : 1 });
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
