"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  booksApi,
  type Facet,
  type Field,
  type Picked,
  type Row,
  type RowOrder,
  type TableView,
} from "@/components/books/api";

/**
 * Один склад строк вкладки на все виды показа.
 *
 * Зачем он есть
 * ─────────────
 * Раздел показывает одну и ту же вкладку двумя способами — таблицей и
 * карточками. Соблазн сделать каждому виду собственную загрузку велик: так
 * быстрее писать, и каждый вид получается самостоятельным. Через неделю это
 * означает два списка одних и тех же строк, живущих порознь: правку, сделанную
 * в таблице, карточки не видят, пока их не перечитать, и наоборот. Человек при
 * этом видит два ответа на один вопрос и не знает, какой из них правда.
 *
 * Поэтому склад один, а виды — только показ. Правка идёт через `patch`,
 * `create` и `remove` этого хука, и после неё оба вида читают одну и ту же
 * строку. База под ними тоже одна: `books.rows`, других копий нет.
 *
 * Почему строки лежат разрежённым массивом
 * ────────────────────────────────────────
 * В пилотном журнале 3634 строки, и будет больше. Тянуть их одним запросом —
 * это мегабайты на открытие раздела и отрисовка ста тысяч ячеек. Поэтому
 * массив имеет длину `total`, а заполнен только там, где страницу уже
 * привезли; грид спрашивает `ensure(from, to)` на то, что видно, и незагруженная
 * строка рисуется заглушкой.
 *
 * Почему кэш по ключу, а не сброс на каждое переключение
 * ──────────────────────────────────────────────────────
 * Порядок у видов разный по делу: таблица держит порядок книги, иначе правка
 * ячейки телепортирует строку наверх; карточкам нужны свежие сверху. Если бы
 * переключатель сбрасывал загруженное, каждое нажатие стоило бы запроса и
 * потерянного места. Ключ кэша — вкладка, порядок и поисковый запрос вместе.
 */

/** Сколько строк в одной странице. Меньше — чаще дёргаем сеть, больше — дольше ждём первую. */
export const PAGE = 250;

export type Order = RowOrder;

type Page = { rows: Row[]; total: number };

type Cache = {
  /**
   * Какой выборке принадлежат эти строки.
   *
   * Ключ лежит в самом кэше не для порядка. Пока его не было, смена вкладки
   * или поиска оставляла на экране прежние строки — новых ещё нет, а старые
   * уже не про то, — и они выглядели как ответ на новый вопрос. В прогоне это
   * поймалось так: поиск, нашедший одну строку, показал 250 карточек прежней
   * выборки. Теперь вид знает, свои ли перед ним строки, и не показывает
   * чужие вовсе.
   */
  key: string;
  total: number;
  rows: (Row | undefined)[];
  loaded: Set<number>;
  loading: Set<number>;
};

const emptyCache = (): Cache => ({
  key: "",
  total: 0,
  rows: [],
  loaded: new Set(),
  loading: new Set(),
});

export type BookTable = {
  meta: TableView["table"] | null;
  /** Колонки без разделителей — то, что имеет смысл показывать и заполнять. */
  fields: Field[];
  /** Все колонки, включая разделители: нужны разметке, но не вводу. */
  allFields: Field[];
  bindings: Record<string, string>;
  roleTitles: Record<string, string>;
  /** Чем можно отобрать эту книгу — считается сервером по самой книге. */
  facets: Facet[];
  /** Строк в текущей выборке: с поиском — сколько нашлось. */
  total: number;
  /** Строк во вкладке целиком. Без него «нашлось 12» не с чем сравнить. */
  totalAll: number;
  rows: (Row | undefined)[];
  ready: boolean;
  error: string;
  clearError: () => void;
  /** Привезти страницы, покрывающие видимый кусок. */
  ensure: (from: number, to: number) => void;
  patch: (row: Row, values: Record<string, unknown>) => Promise<Row | null>;
  create: (values: Record<string, unknown>) => Promise<Row | null>;
  remove: (row: Row) => Promise<boolean>;
  /** Индекс последней добавленной строки — чтобы вид довёл до неё глаз. */
  lastAdded: number | null;
  /**
   * Записи, заведённые за этот заход в раздел.
   *
   * Нужны, потому что в хронике новой записи не место: даты у неё ещё нет, и
   * она уезжает в самый конец, за три с половиной тысячи строк. Человек
   * заполнил форму и не увидел результата — этот дефект в разделе уже был, и
   * порядок «по дате» вернул бы его. Вид показывает их отдельно, наверху.
   */
  added: Row[];
  forgetLastAdded: () => void;
  reload: () => void;
};

/**
 * Колонка-разделитель: заголовок из точек, дефисов или пробелов.
 *
 * В книгах, которые ведут руками, такими колонками разделяют блоки. Данных в
 * них нет, а места в форме и в гриде они занимают столько же, сколько
 * настоящие. Правило одно на все виды и живёт здесь, а не в трёх местах.
 */
export const isSeparator = (field: Field) => /^[.\-\s]*$/.test(field.title);

export function useBookTable(
  tableId: string,
  order: Order,
  query: string,
  /**
   * Чем сузили книгу: величины и период.
   *
   * Отбор идёт на сервере, как и поиск, и по той же причине: отобрать среди
   * приехавших двухсот строк из 3632 значит показать неполный ответ полным.
   */
  picked: Picked = {},
  /**
   * Сколько строк тянуть за раз.
   *
   * Карточкам хватает страницы: человек листает сверху вниз и до конца книги
   * доходит редко. Таблице нужна вся книга сразу — Univer показывает лист
   * целиком, и подгружать страницы под прокрутку в нём некуда: пустые строки
   * посреди журнала читались бы как «здесь ничего нет». Замерено на пилотной
   * книге: 3632 строки — 2,4 МБ и секунда, один раз на открытие.
   */
  pageSize: number = PAGE,
): BookTable {
  const [view, setView] = useState<TableView | null>(null);
  const [cache, setCache] = useState<Cache>(emptyCache);
  const [error, setError] = useState("");
  const [lastAdded, setLastAdded] = useState<number | null>(null);
  const [added, setAdded] = useState<Row[]>([]);
  const [epoch, setEpoch] = useState(0);
  // Размер вкладки целиком запоминается при первом же чтении без поиска —
  // раздел всегда открывается без него, так что к моменту первого запроса
  // число уже известно.
  const [totalAll, setTotalAll] = useState(0);

  // Ключ выборки. Он же живёт в замыканиях всех действий ниже: каждое из них
  // пересоздаётся при смене вкладки, порядка или запроса, и потому всегда
  // адресует тот кэш, для которого было создано. Ref для этого не годится —
  // читать его во время отрисовки нельзя, а после смены ключа старое
  // замыкание с ним полезло бы в чужой кэш.
  // Отбор входит в ключ наравне с поиском: это такая же часть вопроса, и
  // строки одного отбора не должны показываться как ответ на другой.
  const chosen = JSON.stringify(picked);
  const key = `${tableId}|${order}|${query}|${pageSize}|${chosen}`;
  const caches = useRef(new Map<string, Cache>());
  // `epoch` растёт на `reload()` и заставляет эффект перечитать вкладку.
  void epoch;

  const fail = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
  }, []);

  /** Первая страница: она же приносит схему и общее число строк. */
  useEffect(() => {
    if (!tableId) return;
    let cancelled = false;

    const cached = caches.current.get(key);
    if (cached) setCache(cached);

    booksApi.table(tableId, pageSize, 0, order, query, picked).then(
      (next) => {
        if (cancelled) return;
        setView(next);
        const fresh: Cache = {
          key,
          total: next.total,
          rows: new Array(next.total),
          loaded: new Set([0]),
          loading: new Set(),
        };
        next.rows.forEach((row, index) => {
          fresh.rows[index] = row;
        });
        caches.current.set(key, fresh);
        setCache(fresh);
        if (!query) setTotalAll(next.total);
        setError("");
      },
      (err: unknown) => {
        if (cancelled) return;
        fail(err, "Не удалось открыть вкладку");
      },
    );

    return () => {
      cancelled = true;
    };
    // `picked` приходит новым объектом на каждую отрисовку, поэтому в
    // зависимостях стоит его слепок строкой, а не он сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, order, query, key, epoch, pageSize, chosen, fail]);

  /** Страница под видимым куском. Уже привезённое и уже едущее не трогаем. */
  const ensure = useCallback(
    (from: number, to: number) => {
      const current = caches.current.get(key);
      if (!current || !tableId) return;
      const first = Math.max(0, Math.floor(from / pageSize));
      const last = Math.min(
        Math.floor(Math.max(0, to) / pageSize),
        Math.max(0, Math.ceil(current.total / pageSize) - 1),
      );
      for (let page = first; page <= last; page += 1) {
        if (current.loaded.has(page) || current.loading.has(page)) continue;
        current.loading.add(page);
        const at = key;
        booksApi.table(tableId, pageSize, page * pageSize, order, query, picked).then(
          (next: Page) => {
            const store = caches.current.get(at);
            if (!store) return;
            store.loading.delete(page);
            store.loaded.add(page);
            next.rows.forEach((row, index) => {
              store.rows[page * pageSize + index] = row;
            });
            if (caches.current.get(at) === store) setCache({ ...store });
          },
          (err: unknown) => {
            const store = caches.current.get(at);
            store?.loading.delete(page);
            fail(err, "Не удалось дочитать строки");
          },
        );
      }
    },
    // Тот же слепок, та же причина, что и у эффекта выше.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tableId, order, query, key, pageSize, chosen, fail],
  );

  /** Положить строку, пришедшую с сервера, во все кэши, где она встречается. */
  const absorb = useCallback(
    (saved: Row) => {
      caches.current.forEach((store) => {
        const at = store.rows.findIndex((row) => row?.id === saved.id);
        if (at !== -1) store.rows[at] = saved;
      });
      // И в списке заведённого за этот заход тоже.
      //
      // Он держит копии строк, и без этой строчки они устаревают на первой же
      // правке: версия остаётся прежней, а строка в базе уходит вперёд.
      // Следующее действие над такой копией — удаление, например, — уезжало со
      // старой версией и молча отклонялось как чужая правка.
      setAdded((now) =>
        now.some((row) => row.id === saved.id)
          ? now.map((row) => (row.id === saved.id ? saved : row))
          : now,
      );
      const here = caches.current.get(key);
      if (here) setCache({ ...here });
    },
    [key],
  );

  const patch = useCallback(
    async (row: Row, values: Record<string, unknown>) => {
      try {
        const saved = await booksApi.updateRow(tableId, row.id, values, row.version);
        absorb(saved);
        setError("");
        return saved;
      } catch (err) {
        fail(err, "Не удалось сохранить правку");
        return null;
      }
    },
    [tableId, absorb, fail],
  );

  const create = useCallback(
    async (values: Record<string, unknown>) => {
      try {
        const saved = await booksApi.createRow(tableId, values);
        // Новая строка встаёт в конец книги, а при «свежие сверху» — в начало.
        // Кладём её туда же, куда её положит сервер, и запоминаем место: вид
        // обязан довести до неё глаз, иначе запись «пропала».
        const store = caches.current.get(key);
        let at: number | null = null;
        if (store) {
          at = order === "recent" ? 0 : store.total;
          store.rows.splice(at, 0, saved);
          store.total += 1;
          setCache({ ...store });
        }
        // Остальные кэши той же вкладки больше не полны — пусть перечитаются.
        caches.current.forEach((other, otherKey) => {
          if (otherKey !== key && otherKey.startsWith(`${tableId}|`)) {
            caches.current.delete(otherKey);
          }
        });
        setLastAdded(at);
        setAdded((now) => [saved, ...now]);
        setTotalAll((now) => now + 1);
        setError("");
        return saved;
      } catch (err) {
        fail(err, "Не удалось добавить запись");
        return null;
      }
    },
    [tableId, order, key, fail],
  );

  const remove = useCallback(
    async (row: Row) => {
      try {
        await booksApi.deleteRow(tableId, row.id, row.version);

        // Из текущей выборки строку убираем на руках — иначе список дёрнулся бы
        // ожиданием ответа на месте, где всё уже решено.
        const here = caches.current.get(key);
        if (here) {
          const at = here.rows.findIndex((item) => item?.id === row.id);
          if (at !== -1) {
            here.rows.splice(at, 1);
            here.total = Math.max(0, here.total - 1);
          }
          setCache({ ...here });
        }

        // Остальные выборки той же вкладки выбрасываем целиком, а не правим.
        // Поправить их нельзя честно: строка лежит в них на непрочитанной
        // странице, и «есть ли она здесь» знает только сервер. Прошлая попытка
        // вычитала единицу лишь там, где строка оказалась загружена, — и после
        // удаления записи из отфильтрованного списка книга по-прежнему
        // показывала прежний размер, пока страницу не обновят. Симметрично
        // тому, как поступает `create`.
        caches.current.forEach((_, otherKey) => {
          if (otherKey !== key && otherKey.startsWith(`${tableId}|`)) {
            caches.current.delete(otherKey);
          }
        });
        setAdded((now) => now.filter((item) => item.id !== row.id));
        setTotalAll((now) => Math.max(0, now - 1));
        setError("");
        return true;
      } catch (err) {
        fail(err, "Не удалось убрать строку");
        return false;
      }
    },
    [tableId, key, fail],
  );

  const reload = useCallback(() => {
    // Перечитали книгу — заведённое в ней уже на своих местах, держать
    // его отдельным списком незачем.
    setAdded([]);
    caches.current.clear();
    setEpoch((value) => value + 1);
  }, []);

  const allFields = useMemo(() => view?.fields ?? [], [view]);
  const fields = useMemo(
    () => allFields.filter((field) => !isSeparator(field)),
    [allFields],
  );

  return {
    meta: view?.table ?? null,
    fields,
    allFields,
    bindings: view?.bindings ?? {},
    roleTitles: view?.role_titles ?? {},
    facets: view?.facets ?? [],
    total: cache.total,
    totalAll: query ? totalAll : cache.total,
    rows: cache.rows,
    // Готово — это «строки на экране про то, что спросили». Совпадения
    // вкладки мало: порядок и поиск тоже часть вопроса.
    ready: !!view && view.table.id === tableId && cache.key === key,
    error,
    clearError: () => setError(""),
    ensure,
    patch,
    create,
    remove,
    lastAdded,
    // Список привязан к вкладке: у другой книги свои записи.
    added: view && view.table.id === tableId ? added : [],
    forgetLastAdded: () => setLastAdded(null),
    reload,
  };
}
