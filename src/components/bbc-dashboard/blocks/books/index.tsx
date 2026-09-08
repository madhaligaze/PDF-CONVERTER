"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { booksApi, type Board, type Book, type Row } from "@/components/books/api";
import { BindingBoard } from "@/components/books/binding-board";
import { ImportDialog } from "@/components/books/import-dialog";
import { useBookTable, type Order } from "@/components/books/use-book-table";
import { CardsView } from "@/components/bbc-dashboard/blocks/books/cards-view";
import { GridView } from "@/components/bbc-dashboard/blocks/books/grid-view";
import { RecordModal } from "@/components/bbc-dashboard/blocks/books/record-modal";

/**
 * «Книги» — единственное место, где живут внутренние копии книг компании.
 *
 * Два вида на одну книгу
 * ──────────────────────
 * Одну и ту же вкладку показываем таблицей и карточками, и переключатель между
 * ними — не украшение. Финансист, тридцать лет работавший в Google Sheets,
 * ищет знакомую решётку и не станет заполнять формы; человек, пришедший
 * отметить три платежа, в решётке из двадцати четырёх колонок теряется. Ни
 * один из этих двух не должен уходить обратно в Google — а уйдёт тот, кому мы
 * не дали привычную поверхность.
 *
 * База под видами одна, и это главное свойство раздела: `books.rows`, никаких
 * вторых копий. Строки для обоих видов держит `useBookTable`, правка идёт через
 * него же, поэтому исправленное в таблице видно в карточках сразу — не после
 * обновления страницы и не «когда-нибудь синхронизируется».
 *
 * Разметка колонок стоит рядом с переключателем, но в него не входит. Вид —
 * это как показывать одни и те же строки, а разметка — что эти колонки
 * означают для расчётов; смешивать их в одном ряду значило бы предлагать
 * человеку «третий способ посмотреть журнал», которым она не является.
 *
 * Отличие от журнала касаний, который стоит рядом в меню: касание живёт только
 * у нас, в книгах его нет вовсе. Здесь наоборот — запись ложится в книгу, из
 * которой дашборд считает цифры.
 */

type Mode = "grid" | "cards";

/** Порядок строк у вида — свойство вида, а не настройка. См. `useBookTable`. */
const ORDER: Record<Mode, Order> = { grid: "position", cards: "recent" };

const MODE_KEY = "bbc.books.mode";

/**
 * Каким видом открыть раздел.
 *
 * Выбор человека сильнее всего и живёт между заходами. Пока выбора нет, вид
 * подсказывает экран: на телефоне таблица из двадцати четырёх колонок в 390
 * пикселях — это не таблица, а щель, в которую видно две колонки. Показать
 * такое первым — верный способ убедить человека, что в приложении работать
 * нельзя, и вернуть его в Google Sheets.
 *
 * Раз выбрав, он получит своё на любом экране: запомненное не перебивается
 * шириной.
 */
function rememberedMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "cards" || saved === "grid") return saved;
  } catch {
    /* приватное окно — считаем, что выбора не было */
  }
  return typeof window !== "undefined" && window.innerWidth < 640 ? "cards" : "grid";
}

type Props = {
  /** Писать может только вошедший: у ссылки отдела нет автора для подписи. */
  canWrite: boolean;
};

export function BooksBlock({ canWrite }: Props) {
  const [books, setBooks] = useState<Book[]>([]);
  // Выбранная вкладка — не состояние, а вывод: пусто означает «первая из
  // списка». Присваивать её в эффекте пришлось бы после загрузки книг, а это
  // лишний проход отрисовки и повод для гонки, если книги приедут дважды.
  const [chosen, setChosen] = useState("");
  // Лениво из `localStorage`: до входа в дашборд этот раздел на сервере не
  // отрисовывается вовсе (пока не пришёл ответ «кто вы», на экране стоит
  // заставка), поэтому расхождения разметки с серверной здесь быть не может.
  const [mode, setMode] = useState<Mode>(rememberedMode);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");

  const loadBooks = useCallback(
    () =>
      booksApi
        .books()
        .then((data) => setBooks(data.books))
        .catch((err) =>
          setListError(err instanceof Error ? err.message : "Не удалось получить книги"),
        )
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const tabs = useMemo(
    () =>
      books.flatMap((book) =>
        // Список, а не «список или что-то ещё»: неожиданная форма ответа не
        // должна ронять экран. Так уже выходило — бэкенд отдал число вместо
        // вкладок, и `.map` уронил вкладку браузера целиком.
        (Array.isArray(book.tables) ? book.tables : []).map((tab) => ({
          id: tab.id,
          name: tab.name,
          book: book.title,
        })),
      ),
    [books],
  );

  const tableId = chosen || tabs[0]?.id || "";

  /** Поиск уходит на сервер не на каждую букву: книга большая, а рук у неё одни. */
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const data = useBookTable(tableId, ORDER[mode], query);

  /** Разметка читается только когда её открыли: на ежедневный ввод она не нужна. */
  const boardHere = board && board.table.id === tableId ? board : null;

  useEffect(() => {
    if (!columnsOpen || !tableId || boardHere) return;
    let cancelled = false;
    booksApi.board(tableId).then(
      (next) => {
        if (!cancelled) setBoard(next);
      },
      () => {
        /* ошибку покажет общий обработчик ниже при следующем действии */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [columnsOpen, tableId, boardHere]);

  const chooseMode = (next: Mode) => {
    setMode(next);
    setColumnsOpen(false);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* приватное окно — режим просто не запомнится */
    }
  };

  const error = listError || data.error;

  if (loading) return <p className="bbc-reg-hint">Читаем книги…</p>;

  if (tabs.length === 0) {
    return (
      <div className="bbc-reg">
        {error && (
          <p className="bbc-reg-error" role="alert">
            {error}
          </p>
        )}
        <div className="bbc-reg-empty">
          <h3>Пока ни одной книги</h3>
          <p>
            Приложение разберёт колонки привезённой книги и покажет, что нашло,
            прежде чем что-либо применить. В исходную книгу оно не пишет.
          </p>
          {canWrite && (
            <button className="btn-primary" onClick={() => setImporting(true)}>
              Привезти книгу из Google
            </button>
          )}
        </div>
        <ImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          onImported={(id) => {
            loadBooks();
            setChosen(id);
            setColumnsOpen(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="bbc-reg">
      {error && (
        <p className="bbc-reg-error" role="alert">
          {error}
        </p>
      )}

      <div className="bbc-reg-bar">
        <label className="bbc-reg-pick">
          <span className="sr-only">Книга и вкладка</span>
          <select
            className="input-field"
            value={tableId}
            onChange={(event) => {
              setChosen(event.target.value);
              setTyped("");
              setColumnsOpen(false);
              data.forgetLastAdded();
            }}
          >
            {tabs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.book} — вкладка «{item.name}»
              </option>
            ))}
          </select>
        </label>

        <input
          className="input-field bbc-reg-search"
          type="search"
          placeholder="Поиск по книге"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />

        {/* Счётчик — не подпись, а ответ поиска. Он же единственное место, где
            видно размер книги: раньше «нашлось 12» считалось по двумстам
            загруженным строкам из 3634 и было неотличимо от правды. */}
        <output className="bbc-books-count">
          {!data.ready
            ? ""
            : query
              ? `${data.total.toLocaleString("ru-RU")} из ${data.totalAll.toLocaleString("ru-RU")}`
              : data.total.toLocaleString("ru-RU")}
        </output>
      </div>

      <div className="bbc-reg-bar">
        <div className="bbc-seg" role="group" aria-label="Как показывать книгу">
          <button
            type="button"
            className="bbc-seg-btn"
            aria-pressed={mode === "grid" && !columnsOpen}
            onClick={() => chooseMode("grid")}
          >
            Таблица
          </button>
          <button
            type="button"
            className="bbc-seg-btn"
            aria-pressed={mode === "cards" && !columnsOpen}
            onClick={() => chooseMode("cards")}
          >
            Карточки
          </button>
        </div>

        <div className="bbc-books-acts">
          {canWrite && (
            <button
              className="btn-primary text-xs px-3 py-1.5"
              onClick={() => setAdding(true)}
            >
              Добавить запись
            </button>
          )}
          <button
            className="btn-ghost text-xs px-3 py-1.5"
            aria-pressed={columnsOpen}
            onClick={() => setColumnsOpen((open) => !open)}
          >
            Колонки
          </button>
          {canWrite && (
            <button
              className="btn-ghost text-xs px-3 py-1.5"
              onClick={() => setImporting(true)}
            >
              Привезти книгу
            </button>
          )}
        </div>
      </div>

      {columnsOpen ? (
        boardHere ? (
          <BindingBoard
            board={boardHere}
            onChange={(next) => {
              setBoard(next);
              // Привязки меняют смысл колонок для обоих видов — карточка
              // собирается по ролям. Перечитываем вкладку, а не надеемся,
              // что человек сам догадается обновить страницу.
              data.reload();
            }}
          />
        ) : (
          <p className="bbc-reg-hint">Читаем разметку…</p>
        )
      ) : !data.ready ? (
        <p className="bbc-reg-hint">Открываем вкладку…</p>
      ) : data.total === 0 ? (
        <p className="bbc-reg-hint">
          {query ? "По этому запросу в книге ничего нет" : "В этой вкладке пока нет строк"}
        </p>
      ) : mode === "grid" ? (
        <GridView data={data} canWrite={canWrite} onOpenRecord={setEditing} />
      ) : (
        // Ключ пересобирает вид при смене вкладки или запроса: у карточек своё
        // состояние — докуда долистали, — и переносить его на другую книгу
        // означало бы показать её сразу с середины.
        <CardsView
          key={`${tableId}|${query}`}
          data={data}
          canWrite={canWrite}
          onOpenRecord={setEditing}
        />
      )}

      {data.ready && (adding || editing) && (
        <RecordModal
          // Одна открытая запись — одна форма. Без ключа форма, открытая на
          // другой строке, донашивала бы состояние предыдущей.
          key={editing?.id ?? "new"}
          data={data}
          row={editing}
          canWrite={canWrite}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(id) => {
          loadBooks();
          setChosen(id);
          setColumnsOpen(true);
        }}
      />
    </div>
  );
}
