"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { booksApi, type Field, type Row } from "@/components/books/api";
import {
  buildWorkbook,
  editAt,
  firstBlankRow,
  HEADER_ROW,
  valueOf,
} from "@/components/books/sheet-model";
import { useFillHeight } from "@/components/books/use-fill-height";
import { UniverSheet, type UniverApi } from "@/components/univer/sheet";

/**
 * Книга в настоящей таблице.
 *
 * Почему не своя решётка
 * ──────────────────────
 * Своя была: виртуализированная, с правкой по ячейке и пустой строкой внизу.
 * Она проходила все проверки и всё равно оказалась непригодной — человек,
 * двадцать лет работавший в Excel, приходит с готовыми привычками: выделить
 * диапазон и увидеть сумму, потянуть за угол, вставить скопированный столбец
 * из письма, нажать Ctrl+Z. Ни одной из них самодельная решётка не отвечала, и
 * догонять их по одной значит писать Univer заново и хуже.
 *
 * Что здесь своего
 * ────────────────
 * Univer рисует и редактирует, а этот компонент отвечает за две вещи, которых
 * Univer знать не может.
 *
 * 1. **Правка ячейки — это правка строки книги.** Лист не хранит данные; он
 *    показывает `books.rows`. Каждое изменение переводится в PATCH ровно того
 *    поля, которое тронули, а печать в первой пустой строке заводит запись.
 *
 * 2. **Права.** Администратору таблица дана целиком, включая состав колонок:
 *    вставил столбец — он появился в книге у всех. Сотруднику тот же лист
 *    выдан шаблоном: заполняй ячейки, добавляй строки, сортируй и фильтруй для
 *    себя — но не переделывай. Колонка общая, и сотрудник, убравший «Проект»,
 *    убрал бы его у всех и заодно из расчётов дашборда.
 *
 * Права ставятся механизмом самого Univer, а не пряталками в интерфейсе:
 * спрятанная кнопка не мешает ни горячей клавише, ни вставке из буфера.
 * Сервер при этом проверяет их заново — маршруты колонок закрыты `require_admin`.
 */

type Props = {
  tableId: string;
  name: string;
  fields: Field[];
  rows: (Row | undefined)[];
  total: number;
  /** Полные права на таблицу, включая состав колонок. */
  isAdmin: boolean;
  /** Право писать вообще. Ложь у держателя ссылки отдела. */
  canWrite: boolean;
  /** Книга изменилась так, что её надо перечитать (колонки). */
  onStructureChanged: () => void;
  onError: (message: string) => void;
};

/**
 * Сколько строк книги помещается на экран.
 *
 * Высота строки и панелей Univer прибиты числами, и это честнее, чем кажется:
 * они нужны ровно для того, чтобы решить, на сколько строк отмотать при
 * открытии. Ошибка в пару строк тут ничего не портит — человек видит конец
 * книги либо чуть выше, либо чуть ниже.
 */
const ROW_H = 24;
const CHROME_H = 130;

const visibleRows = (height: number) => Math.max(4, Math.floor((height - CHROME_H) / ROW_H));

/** Команды Univer, меняющие состав колонок. Их мы переносим в книгу. */
const INSERT_COL = "sheet.command.insert-col";
const REMOVE_COL = "sheet.command.remove-col";

export function BooksSheet({
  tableId,
  name,
  fields,
  rows,
  total,
  isAdmin,
  canWrite,
  onStructureChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  // Лист кончается там же, где окно: иначе у страницы и у таблицы получаются
  // две прокрутки, и человек тянет одну, а едет другая.
  const { ref: box, height } = useFillHeight(320);
  // Высота нужна обработчику, который живёт дольше отрисовки.
  const heightRef = useRef(height);
  heightRef.current = height;

  // Всё, что нужно обработчикам Univer, живёт в ref: подписки ставятся один
  // раз на книгу, а колонки и строки приезжают заново. Без этого обработчик
  // помнил бы первый набор полей и писал бы правки не в те ключи.
  const state = useRef({ tableId, fields, rows, total, isAdmin, canWrite });
  state.current = { tableId, fields, rows, total, isAdmin, canWrite };

  const notify = useRef(onError);
  notify.current = onError;
  const restructured = useRef(onStructureChanged);
  restructured.current = onStructureChanged;

  const workbook = useMemo(
    () => buildWorkbook(name, fields, rows, total),
    [name, fields, rows, total],
  );

  /** Записать правку одной ячейки в книгу. */
  const save = useCallback(async (sheetRow: number, sheetColumn: number, cell: unknown) => {
    const { tableId: id, fields: cols, rows: lines, total: count } = state.current;
    const edit = editAt(cols, count, sheetRow, sheetColumn, cell);
    if (!edit) return;

    try {
      if (edit.index === null) {
        // Печать под последней записью заводит строку. Пустое значение строку
        // не заводит: человек проехал по листу и стёр случайно набранное — это
        // не повод класть в книгу пустую запись.
        if (!edit.value) return;
        await booksApi.createRow(id, { [edit.field.key]: edit.value });
        restructured.current();
        return;
      }
      const row = lines[edit.index];
      if (!row) return;
      await booksApi.updateRow(id, row.id, { [edit.field.key]: edit.value }, row.version);
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось сохранить правку");
    }
  }, []);

  /** Переименование колонки — правка её заголовка в шапке листа. */
  const rename = useCallback(async (column: number, cell: unknown) => {
    const { tableId: id, fields: cols, isAdmin: admin } = state.current;
    const field = cols[column];
    const title = valueOf(cell).trim();
    if (!admin || !field || !title || title === field.title) return;
    try {
      await booksApi.updateField(id, field.key, { title });
      restructured.current();
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось переименовать колонку");
    }
  }, []);

  /** Вставленный столбец заводится в книге и получает имя из шапки. */
  const insertColumn = useCallback(async (params: Record<string, unknown> | undefined) => {
    const { tableId: id, fields: cols } = state.current;
    const at = columnOf(params);
    if (at === null) return;
    const after = at > 0 ? cols[at - 1]?.key ?? null : null;
    setBusy(true);
    try {
      await booksApi.addField(id, { title: "Новая колонка", type: "text", after });
      restructured.current();
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось добавить колонку");
    } finally {
      setBusy(false);
    }
  }, []);

  const removeColumn = useCallback(async (params: Record<string, unknown> | undefined) => {
    const { tableId: id, fields: cols } = state.current;
    const at = columnOf(params);
    const field = at === null ? null : cols[at];
    if (!field) return;
    setBusy(true);
    try {
      await booksApi.removeField(id, field.key);
      restructured.current();
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось убрать колонку");
    } finally {
      setBusy(false);
    }
  }, []);

  const onReady = useCallback(
    (api: UniverApi) => {
      const disposers: Array<() => void> = [];

      applyPermissions(api, state.current.isAdmin, state.current.canWrite).catch(() => {
        /* права — не повод ронять экран; сервер проверяет их заново */
      });

      // Довести взгляд до конца книги: работают всегда там, а первая строка
      // журнала — это операция трёхлетней давности.
      //
      // Выделить ячейку мало — от этого едет только курсор, а на экране
      // остаётся начало книги. Нужна ещё прокрутка, и делать её надо не в этот
      // кадр: лист в момент готовности фасада ещё не измерил себя, и
      // прокручивать пока нечего.
      const bottom = firstBlankRow(state.current.total);
      let tries = 0;
      let timer = 0;
      const drive = () => {
        tries += 1;
        let moved = false;
        try {
          const sheet = api.getActiveWorkbook()?.getActiveSheet();
          if (sheet) {
            sheet.setActiveRange(sheet.getRange(bottom, 0, 1, 1));
            // Прокрутка ставит названную строку ВВЕРХ экрана. Назови мы пустую
            // строку — она и встала бы первой, а последние записи книги ушли бы
            // выше края: человек видел бы экран пустых строк и ни одной своей.
            // Поэтому наверх отправляем строку на экран выше, и пустая
            // оказывается внизу, сразу под последней записью.
            sheet.scrollToCell?.(Math.max(0, bottom - visibleRows(heightRef.current) + 2), 0);
            moved = true;
          }
        } catch {
          /* лист ещё не измерил себя — попробуем следующим тактом */
        }
        // Несколько попыток, а не одна: лист становится готов к прокрутке не в
        // тот же кадр, что фасад, и по одной попытке курсор уезжал в конец
        // книги, а на экране оставалось её начало. Три такта — это доли
        // секунды; не доехали и за них — книга всё равно открыта и листается.
        if (!moved && tries < 3) timer = window.setTimeout(drive, 120);
      };
      timer = window.setTimeout(drive, 60);
      disposers.push(() => window.clearTimeout(timer));

      const values = api.addEvent?.(api.Event.SheetValueChanged, (event: {
        effectedRanges?: Array<{ getRow: () => number; getColumn: () => number }>;
      }) => {
        const sheet = api.getActiveWorkbook()?.getActiveSheet();
        if (!sheet) return;
        for (const range of event.effectedRanges ?? []) {
          const row = range.getRow();
          const column = range.getColumn();
          const cell = sheet.getRange(row, column, 1, 1).getCellData?.();
          if (row === HEADER_ROW) void rename(column, cell);
          else void save(row, column, cell);
        }
      });
      if (values?.dispose) disposers.push(() => values.dispose());

      // Состав колонок Univer отдельным событием не сообщает — ловим команды.
      const commands = api.onCommandExecuted?.((command: { id: string; params?: Record<string, unknown> }) => {
        if (!state.current.isAdmin) return;
        if (command.id === INSERT_COL) void insertColumn(command.params);
        if (command.id === REMOVE_COL) void removeColumn(command.params);
      });
      if (commands?.dispose) disposers.push(() => commands.dispose());

      return () => disposers.forEach((stop) => stop());
    },
    [rename, save, insertColumn, removeColumn],
  );

  return (
    <div className="bbc-sheet" ref={box} style={{ height }} data-busy={busy ? "" : undefined}>
      <UniverSheet key={`${tableId}|${fields.length}`} data={workbook} onReady={onReady} />
    </div>
  );
}

/** Индекс колонки из параметров команды Univer. */
function columnOf(params: Record<string, unknown> | undefined): number | null {
  const range = params?.range as { startColumn?: number } | undefined;
  const start = range?.startColumn;
  return typeof start === "number" ? start : null;
}

/**
 * Раздать права листа.
 *
 * Сотруднику лист выдан шаблоном: заполняй ячейки, добавляй строки, сортируй и
 * фильтруй для себя. Всё, что меняет форму книги, — состав колонок, их
 * оформление, удаление строк — закрыто. Не потому что «нельзя доверять», а
 * потому что форма общая: колонка и её порядок одни на всех, кто ведёт книгу.
 */
async function applyPermissions(api: UniverApi, isAdmin: boolean, canWrite: boolean) {
  const sheet = api.getActiveWorkbook()?.getActiveSheet();
  const permission = sheet?.getWorksheetPermission?.();
  if (!permission) return;
  const point = api.Enum?.WorksheetPermissionPoint;
  if (!point) return;

  if (!canWrite) {
    await permission.setReadOnly();
    return;
  }
  if (isAdmin) return; // администратору лист дан целиком

  await permission.applyConfig({
    mode: "editable",
    points: {
      [point.View]: true,
      [point.Edit]: true,
      [point.Copy]: true,
      [point.SetCellValue]: true,
      [point.InsertRow]: true,
      [point.Sort]: true,
      [point.Filter]: true,
      [point.SetCellStyle]: false,
      [point.SetRowStyle]: false,
      [point.SetColumnStyle]: false,
      [point.InsertColumn]: false,
      [point.DeleteColumn]: false,
      [point.DeleteRow]: false,
    },
  });
}
