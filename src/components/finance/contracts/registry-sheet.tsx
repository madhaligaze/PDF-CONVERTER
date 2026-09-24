"use client";

/**
 * «Реестр · таблица» — реестр договоров листом Univer (фронт-план 6.4, 4.7).
 *
 * Здесь только то, что живёт в React: хранилище → лист (`sync`), вопрос
 * «опечатка или с даты» слоем над ячейкой, строка под листом. Всё, что
 * связывает Univer с договорами, — в `sheet-adapter.ts`.
 *
 * Univer роняет серверную отрисовку (`Path2D is not defined`), поэтому тот,
 * кто ставит этот компонент на страницу, берёт его через `next/dynamic` с
 * `ssr: false`. Рядом с листом — только прозрачность: `transform` и `filter` на
 * предке сделали бы его контейнером для `position: fixed` и сломали замеры
 * холста (правило проекта о GSAP). Слой вопроса поэтому — портал в `body`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ChangeMode as ChangeModeValue } from "@/components/finance/api";
import { ChangeMode } from "@/components/finance/contracts/change-mode";
import {
  RegistryBinding,
  buildRegistry,
  paletteNow,
  structureKey,
  type AskGroup,
  type Built,
} from "@/components/finance/contracts/sheet-adapter";
import {
  answer,
  boot,
  cancel,
  getRegistry,
  holdLive,
  useRegistry,
} from "@/components/finance/contracts/store";
import { formatDay } from "@/components/finance/format";
import { UniverSheet, type UniverApi } from "@/components/univer/sheet";
import { useFillHeight } from "@/components/univer/use-fill-height";

type Props = {
  /** Открыть карточку договора (или закрыть — `null`). `ctx` — лист и блок строки. */
  onOpenCard: (id: string | null, ctx?: { view: string; block: number }) => void;
  /** Договор открытой карточки: его строка отмечена, лист к ней прокручивается. */
  openId: string | null;
};

type Note = { text: string; fail: boolean; at: number };

function stillAsking(group: AskGroup): { id: string; key: string }[] {
  const edits = getRegistry().edits;
  return group.items.filter((item) => edits.get(item.id)?.get(item.key)?.state === "asking");
}

export function RegistrySheet({ onOpenCard, openId }: Props) {
  const state = useRegistry((value) => value);
  const { ref: box, height } = useFillHeight(360, 4);
  const [note, setNote] = useState<Note | null>(null);
  const [ask, setAsk] = useState<AskGroup | null>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [late, setLate] = useState(false);
  const binding = useRef<RegistryBinding | null>(null);
  const activeView = useRef<string | null>(null);
  const openRef = useRef(openId);
  const onOpenRef = useRef(onOpenCard);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenRef.current = onOpenCard;
  }, [onOpenCard]);

  // Живой режим, пока лист открыт: чужие правки приходят опросом раз в 2 с.
  useEffect(() => holdLive(), []);

  const ready = state.phase === "ready" && state.schema !== null;
  const structure = useMemo(() => (state.schema ? structureKey(state.schema) : ""), [state.schema]);

  /**
   * Книга собирается заново только при смене раскладки (колонки, листы, права)
   * или по просьбе связки. Правки, чужие договоры и новые значения списков
   * лист переписывает по месту: пересборка — это секунда и потерянная
   * прокрутка.
   */
  const built = useMemo<Built | null>(() => {
    // `generation` — просьба связки собрать книгу заново (лист поменяли в обход).
    if (!ready || !structure || generation < 0) return null;
    return buildRegistry(getRegistry(), paletteNow());
  }, [ready, structure, generation]);

  const onReady = useCallback(
    (api: UniverApi) => {
      if (!built) return;
      const next = new RegistryBinding(
        api,
        built,
        {
          note: (text, fail) => setNote(text ? { text, fail: Boolean(fail), at: Date.now() } : null),
          ask: (group) => setAsk(group),
          openCard: (id, ctx) => onOpenRef.current(id, ctx),
          sheet: (view) => {
            activeView.current = view;
          },
          rebuild: () => setGeneration((value) => value + 1),
        },
        box.current,
      );
      binding.current = next;
      const stop = next.start(activeView.current, openRef.current);
      next.sync(getRegistry());
      if (process.env.NODE_ENV !== "production") {
        // Только в разработке: пробники Playwright читают лист.
        (window as unknown as Record<string, unknown>).__cregSheet = { api, binding: next, build: buildRegistry, palette: paletteNow };
      }
      return () => {
        stop();
        if (binding.current === next) binding.current = null;
      };
    },
    [built, box],
  );

  useEffect(() => {
    binding.current?.sync(state);
  }, [state]);

  useEffect(() => {
    openRef.current = openId;
    binding.current?.setOpen(openId);
  }, [openId]);

  // «Читаем реестр…» — только если чтение затянулось: быстрый ответ не должен
  // мигать подписью.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setLate(true), 400);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // Строка под листом гаснет сама; отказ держится дольше — его читают.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), note.fail ? 12000 : 6000);
    return () => window.clearTimeout(timer);
  }, [note]);

  const settle = useCallback((group: AskGroup, mode: ChangeModeValue | null) => {
    const items = stillAsking(group);
    binding.current?.touch(items);
    for (const item of items) {
      if (mode) answer(item.id, item.key, mode);
      else cancel(item.id, item.key);
    }
    if (mode?.kind === "from_date" && mode.effective_from > (getRegistry().schema?.today ?? "")) {
      // Дата в будущем: в ячейке остаётся прежнее, заметка говорит, что впереди.
      const edits = getRegistry().edits;
      const values = new Map(items.map((item) => [`${item.id}|${item.key}`, edits.get(item.id)?.get(item.key)?.value]));
      binding.current?.markAhead(
        items,
        (item) =>
          `с ${formatDay(mode.effective_from)} — ${binding.current?.valueText(item.id, item.key, values.get(`${item.id}|${item.key}`)) ?? ""}`,
      );
    }
    setAsk(null);
    setSpot(null);
    binding.current?.focus();
  }, []);

  // Слой вопроса едет вместе с ячейкой; ячейка ушла из видимой части листа,
  // лист сменили или на вопрос ответили в карточке — слой закрывается, как Esc.
  useEffect(() => {
    if (!ask) return;
    let frame = 0;
    // Несколько кадров подряд: лист в момент вопроса может ещё доезжать до
    // ячейки (Enter сдвинул выделение, прокрутка догоняет), и один кадр «не
    // видно» не повод снимать правку.
    let hidden = 0;
    const tick = () => {
      if (!stillAsking(ask).length) {
        setAsk(null);
        setSpot(null);
        return;
      }
      const rect = binding.current?.rectOf(ask);
      if (!rect || !rect.visible) {
        hidden += 1;
        if (hidden >= 6) {
          settle(ask, null);
          return;
        }
        frame = window.requestAnimationFrame(tick);
        return;
      }
      hidden = 0;
      const left = Math.round(rect.left);
      const top = Math.round(rect.bottom + 6);
      setSpot((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [ask, settle]);

  // Клик мимо вопроса — то же, что Esc: молча сохранить правку «как-нибудь»
  // нельзя, сервер её всё равно не примет.
  useEffect(() => {
    if (!ask) return;
    const onDown = (event: PointerEvent) => {
      if (pop.current && event.target instanceof Node && pop.current.contains(event.target)) return;
      settle(ask, null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [ask, settle]);

  const count = ask ? stillAsking(ask).length : 0;
  // Рамка листа стоит с первого кадра, даже пока реестр читается: замер
  // высоты вешается на неё один раз при монтировании. Когда рамка появлялась
  // только после чтения, замер уже прошёл впустую, и лист оставался на
  // минимуме — 360 пикселей и пустота под ним.
  return (
    <div>
      <div
        ref={box}
        className="creg-sheet-wrap"
        style={{ height }}
        onKeyDownCapture={(event) => {
          // Alt+Enter — карточка договора активной строки (в редакторе ячейки
          // Alt+Enter остаётся переводом строки).
          if (event.altKey && event.key === "Enter" && binding.current && !binding.current.isEditing()) {
            if (binding.current.openActive()) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }}
      >
        {built ? (
          <UniverSheet key={built.unitId} data={built.snapshot} onReady={onReady} />
        ) : state.phase === "error" ? (
          <p className="creg-sheet-note fin-fail" role="status" style={{ margin: "1rem" }}>
            {state.error || "Реестр не прочитался"} ·{" "}
            <button
              type="button"
              className="fin-link-btn"
              onClick={() => state.company && boot(state.company, state.me, true)}
            >
              Повторить
            </button>
          </p>
        ) : (
          <p className="creg-sheet-note" role="status" aria-live="polite" style={{ margin: "1rem" }}>
            {late ? "Читаем реестр…" : ""}
          </p>
        )}
      </div>
      <p className={note?.fail ? "creg-sheet-note fin-fail" : "creg-sheet-note"} role="status" aria-live="polite">
        {note?.text ?? ""}
      </p>
      {ask && spot && count
        ? createPortal(
            <div ref={pop}>
              <ChangeMode
                count={count}
                style={{ position: "fixed", top: spot.top, left: spot.left, maxWidth: 360 }}
                onFix={() => settle(ask, { kind: "fix" })}
                onFromDate={(iso) => settle(ask, { kind: "from_date", effective_from: iso })}
                onCancel={() => settle(ask, null)}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default RegistrySheet;
