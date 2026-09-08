"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { booksApi, type Row } from "@/components/books/api";
import {
  buildWorkbook,
  editAt,
  firstBlankRow,
  HEADER_ROW,
  valueOf,
} from "@/components/books/sheet-model";
import type { BookTable } from "@/components/books/use-book-table";
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
  /**
   * Тот же склад строк, что у карточек.
   *
   * Лист пишет через него, а не в сеть напрямую: правка сразу оказывается в
   * общем списке, и карточки видят её без перечитывания книги. Раньше лист
   * звал API сам и просил перечитать вкладку целиком — 2,4 МБ на каждую
   * заведённую строку, и лист успевал исчезнуть с экрана посреди набора.
   */
  data: BookTable;
  name: string;
  /** Полные права на таблицу, включая состав колонок. */
  isAdmin: boolean;
  /** Право писать вообще. Ложь у держателя ссылки отдела. */
  canWrite: boolean;
  /**
   * Можно ли дописывать строки. Ложь, когда книга сужена поиском или отбором.
   *
   * Дописать в суженный список нельзя честно: новая строка либо не подойдёт
   * под условия и исчезнет с глаз в тот же миг, либо подойдёт случайно и
   * встанет не туда. И в том и в другом случае человек не поймёт, что
   * произошло с тем, что он напечатал.
   */
  canAppend: boolean;
  onError: (message: string) => void;
};

/** Что случилось с книгой последним — строка под таблицей. */
type Beat = { text: string; at: number } | null;

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

export function BooksSheet({ data, name, isAdmin, canWrite, canAppend, onError }: Props) {
  const { fields, rows, total } = data;
  const [busy, setBusy] = useState(false);
  /**
   * Что записалось последним.
   *
   * Без этой строки таблица молчит. Человек печатает в пустой строке и не
   * знает, завелась запись или он просто набрал текст в клетке; вопрос «а как
   * это сохранится?» задают ровно потому, что ответа на экране нет.
   *
   * Ни точки, ни зелёного: по правилам этого продукта цвет означает отказ, а
   * «всё хорошо», горящее постоянно, перестают замечать. Здесь только слово о
   * том, что произошло, и время.
   */
  const [beat, setBeat] = useState<Beat>(null);
  const say = useCallback((text: string) => setBeat({ text, at: Date.now() }), []);
  // Лист кончается там же, где окно: иначе у страницы и у таблицы получаются
  // две прокрутки, и человек тянет одну, а едет другая.
  const { ref: box, height } = useFillHeight(320);
  // Высота нужна обработчику, который живёт дольше отрисовки.
  const heightRef = useRef(height);
  heightRef.current = height;

  // Всё, что нужно обработчикам Univer, живёт в ref: подписки ставятся один
  // раз на книгу, а колонки и строки приезжают заново. Без этого обработчик
  // помнил бы первый набор полей и писал бы правки не в те ключи.
  const state = useRef({ data, fields, rows, total, isAdmin, canWrite, canAppend });
  state.current = { data, fields, rows, total, isAdmin, canWrite, canAppend };

  const notify = useRef(onError);
  notify.current = onError;
  const report = useRef(say);
  report.current = say;

  /**
   * Строка, которую сейчас заводят в конце книги.
   *
   * Человек печатает слева направо, и вторая ячейка уходит раньше, чем сервер
   * ответил на первую. Без этой памяти обе видели бы «строки ещё нет» и завели
   * бы ДВЕ записи, по половине набранного в каждой. В книге на три с половиной
   * тысячи строк такую пару не заметит никто.
   */
  const appending = useRef<Promise<Row | null> | null>(null);

  const workbook = useMemo(
    () => buildWorkbook(name, fields, rows, total),
    [name, fields, rows, total],
  );

  /** Записать правку одной ячейки в книгу. */
  const save = useCallback(async (sheetRow: number, sheetColumn: number, cell: unknown) => {
    const { fields: cols, rows: lines, total: count, data: store } = state.current;
    const edit = editAt(cols, count, sheetRow, sheetColumn, cell);
    if (!edit) return;

    try {
      if (edit.index === null) {
        if (!state.current.canAppend) {
          report.current("пока книга отобрана, новые записи не заводятся");
          return;
        }
        // Печать под последней записью заводит строку. Пустое значение строку
        // не заводит: человек проехал по листу и стёр случайно набранное — это
        // не повод класть в книгу пустую запись.
        if (!edit.value) return;

        const started = appending.current;
        if (started) {
          // Строку уже заводят соседней ячейкой — дожидаемся её и дописываем
          // в ту же запись, а не заводим вторую.
          const row = await started;
          if (row) {
            await store.patch(row, { [edit.field.key]: edit.value });
            report.current("записано");
          }
          return;
        }

        const promise = store.create({ [edit.field.key]: edit.value });
        appending.current = promise;
        const created = await promise;
        appending.current = null;
        // Номер тот же, что подписан слева на листе, а не индекс в книге. Они
        // расходятся на единицу: первую строку листа занимают заголовки. Пока
        // сообщение считало по-своему, человек печатал в строке 3634 и читал
        // «строка 3633 заведена» — и это ровно то место, где начинают
        // сомневаться, туда ли записалось.
        report.current(created ? `строка ${count + 2} заведена` : "строку завести не удалось");
        return;
      }

      const row = lines[edit.index];
      if (!row) return;
      const saved = await store.patch(row, { [edit.field.key]: edit.value });
      report.current(saved ? "записано" : "правку сохранить не удалось");
    } catch (err) {
      appending.current = null;
      notify.current(err instanceof Error ? err.message : "Не удалось сохранить правку");
    }
  }, []);

  /** Переименование колонки — правка её заголовка в шапке листа. */
  const rename = useCallback(async (column: number, cell: unknown) => {
    const { data: store, fields: cols, isAdmin: admin } = state.current;
    const id = store.meta?.id ?? "";
    const field = cols[column];
    const title = valueOf(cell).trim();
    if (!admin || !field || !title || title === field.title) return;
    try {
      await booksApi.updateField(id, field.key, { title });
      report.current(`колонка «${title}» переименована`);
      store.reload();
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось переименовать колонку");
    }
  }, []);

  /** Вставленный столбец заводится в книге и получает имя из шапки. */
  const insertColumn = useCallback(async (params: Record<string, unknown> | undefined) => {
    const { data: store, fields: cols } = state.current;
    const id = store.meta?.id ?? "";
    const at = columnOf(params);
    if (at === null) return;
    const after = at > 0 ? cols[at - 1]?.key ?? null : null;
    setBusy(true);
    try {
      await booksApi.addField(id, { title: "Новая колонка", type: "text", after });
      report.current("колонка добавлена — назовите её в шапке");
      store.reload();
    } catch (err) {
      notify.current(err instanceof Error ? err.message : "Не удалось добавить колонку");
    } finally {
      setBusy(false);
    }
  }, []);

  const removeColumn = useCallback(async (params: Record<string, unknown> | undefined) => {
    const { data: store, fields: cols } = state.current;
    const id = store.meta?.id ?? "";
    const at = columnOf(params);
    const field = at === null ? null : cols[at];
    if (!field) return;
    setBusy(true);
    try {
      const { hidden } = await booksApi.removeField(id, field.key);
      report.current(
        hidden
          ? `колонка «${field.title}» убрана, скрыто значений: ${hidden}`
          : `колонка «${field.title}» убрана`,
      );
      store.reload();
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

      /**
       * Довезти вид до конца книги и УБЕДИТЬСЯ, что доехали.
       *
       * Раньше здесь было три попытки подряд, и «получилось» означало «вызов не
       * бросил исключение». Этого хватало на быстрой книге и не хватало на
       * большой: лист измеряет себя позже, чем готов фасад, вызов проходил
       * молча и ничего не двигал. Курсор при этом уезжал в конец, а на экране
       * оставалось начало книги — то есть признак «сработало» был, а
       * результата не было.
       *
       * Теперь спрашиваем сам лист, где он стоит, и повторяем, пока не встанет
       * куда надо. Как только встал — прекращаем: человек мог начать листать
       * сам, и дёргать его обратно нельзя.
       */
      const drive = () => {
        tries += 1;
        let arrived = false;
        try {
          const sheet = api.getActiveWorkbook()?.getActiveSheet();
          if (sheet) {
            // Прокрутка ставит названную строку ВВЕРХ экрана. Назови мы пустую
            // строку — она и встала бы первой, а последние записи книги ушли бы
            // выше края: человек видел бы экран пустых строк и ни одной своей.
            // Поэтому наверх отправляем строку на экран выше, и пустая
            // оказывается внизу, сразу под последней записью.
            const target = Math.max(0, bottom - visibleRows(heightRef.current) + 2);
            sheet.setActiveRange(sheet.getRange(bottom, 0, 1, 1));
            sheet.scrollToCell?.(target, 0);
            const at = sheet.getScrollState?.()?.sheetViewStartRow;
            arrived = typeof at === "number" ? at >= target - 2 : false;
          }
        } catch {
          /* лист ещё не измерил себя — попробуем следующим тактом */
        }
        // До полутора секунд: на книге в три с половиной тысячи строк лист
        // готов к прокрутке не сразу. Не доехали и за них — книга всё равно
        // открыта и листается руками.
        if (!arrived && tries < 12) timer = window.setTimeout(drive, 120);
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
    <div className="bbc-sheet-wrap">
      <div className="bbc-sheet" ref={box} style={{ height }} data-busy={busy ? "" : undefined}>
        <UniverSheet
          key={`${data.meta?.id ?? "нет"}|${fields.length}`}
          data={workbook}
          onReady={onReady}
        />
      </div>

      {/*
        Строка под таблицей — ответ на вопрос «а как это сохранится?».

        Кнопки «Сохранить» здесь нет и не будет: в таблице её нет нигде, и
        человек, привыкший к Excel, её не ищет. Но и молчания быть не должно —
        именно из-за него возникает сомнение, записалось ли. Поэтому таблица
        говорит, что сделала последним: «строка 3767 заведена», «записано».

        Подсказка про пустую строку висит, пока в книге ничего не меняли, и
        исчезает после первой же правки: объяснять человеку то, что он уже
        сделал, — это и есть дежурная надпись.
      */}
      <p className="bbc-sheet-beat" role="status">
        {beat ? (
          <>
            <span className="bbc-sheet-beat-what">{beat.text}</span>
            <span className="bbc-sheet-beat-when">
              {new Date(beat.at).toLocaleTimeString("ru-RU", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </>
        ) : canWrite && canAppend ? (
          <span className="bbc-sheet-beat-hint">
            Записи заводят в пустой строке внизу — начните печатать, строка
            появится в книге сама.
          </span>
        ) : null}
      </p>
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
