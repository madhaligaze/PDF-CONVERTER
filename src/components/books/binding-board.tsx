"use client";

import { useMemo, useState } from "react";

import {
  booksApi,
  CONFIDENCE_LABEL,
  TYPE_LABEL,
  type Board,
  type BoardField,
  type BoardSection,
} from "@/components/books/api";

/**
 * «Колонки» — экран, на котором книга и приложение договариваются о смысле.
 *
 * Слева книга рассказывает, какие колонки в ней нашлись и что в них лежит.
 * Приложение отвечает, какие из них оно узнало и что теперь считается.
 *
 * Что здесь было сделано неправильно и почему переписано
 * ─────────────────────────────────────────────────────
 * Первая версия открывалась стеной из двенадцати карточек «не участвует в
 * расчётах» — я поднимал непривязанные колонки наверх, считая их работой,
 * которую человек пришёл сделать. На живой книге непривязанные колонки — это
 * разлиновка («.»), рабочие пометки («Вопросы», «Л/Б/П») и пустые остатки
 * чужих формул. Разбирать там нечего, а пятнадцать работающих колонок уезжали
 * под них.
 *
 * Вторая ошибка была хуже. Над журналом операций писалось «Дебиторка — не
 * хватает: Заказчик, Сумма договора, Сальдо конец». Дебиторка считается из
 * мастер-книги и от журнала ничего не ждёт, но экран этого не знал и выглядел
 * как три сломанных раздела при полностью исправной книге. Теперь раздел
 * показывается, только если хоть одну обязательную величину он берёт отсюда
 * (`bound_required`); остальные сведены в одну серую строку.
 *
 * Про цвет
 * ────────
 * «Считается» — подписью и весом, без точки и без зелёного: постоянно горящий
 * индикатор «всё хорошо» перестают замечать ровно к тому моменту, когда он
 * должен был напугать. Цвет появляется только там, где чего-то не хватает.
 *
 * Про выбор роли
 * ──────────────
 * Привязка меняется списком, а не перетаскиванием. Перетаскивание выглядит
 * живее, но не работает с клавиатуры, плохо живёт на телефоне и требует
 * попадания мышью в мелкую цель — а раскладывать предстоит сорок колонок.
 */

type Props = {
  board: Board;
  onChange: (board: Board) => void;
};

function fillLabel(field: BoardField): string {
  const ratio = field.stats.fill_ratio ?? 0;
  const scanned = field.stats.scanned ?? 0;
  if (!scanned) return "";
  return `заполнена на ${Math.round(ratio * 100)}%`;
}

function examplesLabel(field: BoardField): string {
  const examples = (field.stats.examples ?? []).slice(0, 2);
  return examples.length ? examples.join(" · ") : "";
}

/**
 * Раздел берёт из этой книги хоть одну обязательную величину — иначе он к ней
 * не относится и на её табло ему делать нечего.
 *
 * Два запасных пути ниже — не перестраховка. Фронт и бэкенд едут разными
 * деплоями, и между ними есть окно, когда страница уже новая, а `bound_required`
 * с сервера ещё не приходит. Без запасного пути `undefined ?? 0` объявил бы все
 * разделы посторонними, и табло сообщило бы «приложение не узнало ни одной
 * величины» на полностью разложенной книге.
 */
function relatesToBook(section: BoardSection): boolean {
  if (typeof section.bound_required === "number") return section.bound_required > 0;
  const required = section.required?.length;
  if (typeof required === "number") {
    return required - (section.missing_required?.length ?? 0) > 0;
  }
  return true;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function BindingBoard({ board, onChange }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  const bound = useMemo(
    () => board.fields.filter((f) => f.role).sort((a, b) => a.position - b.position),
    [board.fields],
  );

  /**
   * Непривязанные — в конец и в один порядок: сначала те, в которых есть
   * данные (их ещё можно осмысленно разложить), потом пустые и разлиновка.
   */
  const free = useMemo(() => {
    const empty = (f: BoardField) =>
      !(f.stats.fill_ratio ?? 0) || /^[.\-\s]*$/.test(f.title);
    return board.fields
      .filter((f) => !f.role)
      .sort(
        (a, b) => Number(empty(a)) - Number(empty(b)) || a.position - b.position,
      );
  }, [board.fields]);

  const mine = board.sections.filter(relatesToBook);
  const working = mine.filter((s) => s.computes);
  const waiting = mine.filter((s) => !s.computes);
  const elsewhere = board.sections.filter((s) => !relatesToBook(s));

  /**
   * Список непривязанных раскрыт заранее ровно тогда, когда в нём есть работа:
   * разделу этой книги не хватает величины, и искать её надо среди них. Когда
   * всё сходится, разбирать там нечего — и открывать список незачем.
   */
  const [showFree, setShowFree] = useState(waiting.length > 0);

  async function bind(field: BoardField, roleKey: string) {
    setSaving(field.key);
    setError("");
    try {
      const next = await booksApi.bind(board.table.id, field.key, roleKey || null);
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить привязку");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="bk-board">
      {/* ── Следствие: ради чего человек сюда пришёл ──────────────────── */}
      <section className="bk-consequence card">
        <h3 className="bk-consequence-title">Что идёт в расчёты</h3>

        {/*
          Первая фраза отвечает на вопрос «зачем я здесь».

          Без неё экран открывался списком колонок с выпадающими списками, и
          человек, зашедший из любопытства, не понимал ни что это, ни что с
          этим делать. Объяснять надо один раз и в двух предложениях: что
          связывается с чем и когда сюда вообще заходят.
        */}
        <p className="bk-lede">
          Дашборд считает не по названиям колонок, а по их смыслу: где дата
          операции, где сумма прихода, где контрагент. Ниже видно, что
          приложение уже узнало в этой книге, и там же это поправляется.
          Настраивают это один раз, когда книгу привезли; потом сюда заходят,
          только если колонку переименовали или завели новую.
        </p>

        {mine.length === 0 && (
          <p className="bk-lede">
            Пока приложение не узнало в этой книге ни одной величины — значит и
            считать по ней нечего. Разложите колонки по величинам ниже, и здесь
            появится, какие разделы от этого заработают.
          </p>
        )}

        <ul className="bk-outcome">
          {working.map((section) => (
            <li key={section.key} className="bk-outcome-line">
              <span className="bk-outcome-name">{section.title}</span>
              <span className="bk-outcome-note">считается по этой книге</span>
            </li>
          ))}
          {waiting.map((section) => (
            <li key={section.key} className="bk-outcome-line bk-outcome-short">
              <span className="bk-outcome-name">{section.title}</span>
              <span className="bk-outcome-note">
                не хватает: {section.missing_titles.join(", ")} — найдите эти
                колонки ниже и выберите им величину
              </span>
            </li>
          ))}
        </ul>

        <p className="bk-hint">
          {bound.length} из {board.fields.length}{" "}
          {plural(board.fields.length, "колонки", "колонок", "колонок")} книги
          участвуют в расчётах.
          {elsewhere.length > 0 && (
            <>
              {" "}
              {elsewhere.map((s) => s.title).join(", ")} —{" "}
              {plural(elsewhere.length, "считается", "считаются", "считаются")}{" "}
              из других книг и от этой ничего не ждут.
            </>
          )}
        </p>
      </section>

      {board.refusals.length > 0 && (
        <section className="bk-refusals card" role="alert">
          <h3 className="bk-consequence-title">Нужно решить вручную</h3>
          <ul>
            {board.refusals.map((refusal, index) => (
              <li key={index}>{refusal.reason}</li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="bk-error" role="alert">
          {error}
        </p>
      )}

      {/* ── Работающие колонки ────────────────────────────────────────── */}
      {bound.length > 0 && (
        <section className="bk-fields">
          <h3 className="bk-consequence-title">
            Колонки, которые приложение узнало — {bound.length}
          </h3>
          <div className="bk-field-grid">
            {bound.map((field) => (
              <FieldCard
                key={field.key}
                field={field}
                board={board}
                busy={saving === field.key}
                onBind={bind}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Остальные колонки ─────────────────────────────────────────── */}
      {free.length > 0 && (
        <section className="bk-fields">
          <h3 className="bk-consequence-title">
            Остальные колонки — {free.length}
          </h3>
          <p className="bk-hint">
            Это не ошибка. Разлиновка, рабочие пометки и служебные формулы
            остаются в книге и видны на вкладке «Записи» — они просто не
            участвуют в расчётах. Загляните сюда, если наверху чего-то не
            хватает.
          </p>
          <button
            className="btn-ghost text-xs px-2.5 py-1.5 bk-disclose"
            onClick={() => setShowFree((on) => !on)}
            aria-expanded={showFree}
          >
            {showFree ? "Свернуть" : `Показать ${free.length}`}
          </button>
          {showFree && (
            <div className="bk-field-grid">
              {free.map((field) => (
                <FieldCard
                  key={field.key}
                  field={field}
                  board={board}
                  busy={saving === field.key}
                  onBind={bind}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function FieldCard({
  field,
  board,
  busy,
  onBind,
}: {
  field: BoardField;
  board: Board;
  busy: boolean;
  onBind: (field: BoardField, roleKey: string) => void;
}) {
  return (
    <div className={`bk-field${field.role ? "" : " bk-field-free"}`}>
      <div className="bk-field-head">
        <span className="bk-field-title" title={field.title}>
          {field.title || "без заголовка"}
        </span>
        <span className="badge badge-slate">
          {TYPE_LABEL[field.type] ?? field.type}
        </span>
      </div>

      <p className="bk-field-stats">
        {[fillLabel(field), examplesLabel(field)].filter(Boolean).join(" · ") ||
          "в выборке пусто"}
      </p>

      <label className="bk-field-role">
        <span className="sr-only">Величина для колонки «{field.title}»</span>
        <select
          className="input-field"
          value={field.role ?? ""}
          disabled={busy}
          onChange={(event) => onBind(field, event.target.value)}
        >
          <option value="">— не участвует в расчётах —</option>
          {board.roles.map((role) => (
            <option
              key={role.key}
              value={role.key}
              disabled={!!role.bound_to && role.bound_to !== field.key}
            >
              {role.title}
              {role.bound_to && role.bound_to !== field.key ? " (занята)" : ""}
            </option>
          ))}
        </select>
      </label>

      {field.role && !field.confirmed && field.suggestion && (
        <p className="bk-field-why">
          узнано по названию:{" "}
          {CONFIDENCE_LABEL[field.suggestion.confidence] ??
            field.suggestion.confidence}
        </p>
      )}
      {field.confirmed && <p className="bk-field-why">выбрано вручную</p>}
    </div>
  );
}
