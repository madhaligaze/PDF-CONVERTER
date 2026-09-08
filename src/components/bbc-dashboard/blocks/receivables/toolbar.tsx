"use client";

/**
 * Тулбар реестра: отделы, наши юрлица, поиск и фильтры.
 *
 * Состояние здесь не своё. Тулбар правит те же `Filters`, что и вся страница,
 * поэтому выбор отдела остаётся в адресе, переживает перезагрузку и виден
 * в общей строке фильтров. Локальный стейт дал бы второй, расходящийся с
 * первым, набор истины.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { money } from "../../format";
import { department } from "../../department";
import { PieChartIcon, SlidersIcon } from "../../icon";
import type { FilterKey } from "../../controls";
import type { Filters } from "../../use-dataset";
import type { BbcDataset } from "../../types";

export type ToolbarProps = {
  dataset: BbcDataset;
  filters: Filters;
  onToggleFilter: (key: FilterKey, value: string) => void;
  onSearch: (value: string) => void;
  onClear: () => void;
  activeFilterCount: number;
  /** Долг по отделам — подпись под кнопкой отдела, чтобы выбор был осмысленным. */
  debtByDepartment: Map<string, number>;
  /**
   * Долг целиком, посчитанный по строкам один раз.
   *
   * Отдельным полем, а не суммой карты выше: строка, числящаяся за четырьмя
   * отделами, лежит в карте четырежды — так и надо для подписи отдела и так
   * нельзя для итога.
   */
  totalDebt: number;
  minDebt: number;
  onMinDebt: (value: number) => void;
  overdueOnly: boolean;
  onOverdueOnly: (value: boolean) => void;
  /** Открыть лист «Итоги» — аналитику по реестру. */
  onTotals: () => void;
};

export function Toolbar({
  dataset,
  filters,
  onToggleFilter,
  onSearch,
  onClear,
  activeFilterCount,
  debtByDepartment,
  totalDebt,
  minDebt,
  onMinDebt,
  overdueOnly,
  onOverdueOnly,
  onTotals,
}: ToolbarProps) {
  const [open, setOpen] = useState(false);
  const [firmsOpen, setFirmsOpen] = useState(false);
  const firmsRef = useRef<HTMLDivElement>(null);

  // Отделы берём из данных, а не из константы: начальник отдела видит только
  // свой, и предлагать ему чужие — обещать то, чего он не откроет.
  const departments = dataset.dimensions.departments;
  const firms = dataset.dimensions.firms;
  const employees = dataset.dimensions.employees;

  useEffect(() => {
    if (!firmsOpen) return;
    function onAway(event: MouseEvent) {
      if (!firmsRef.current?.contains(event.target as Node)) setFirmsOpen(false);
    }
    document.addEventListener("mousedown", onAway);
    return () => document.removeEventListener("mousedown", onAway);
  }, [firmsOpen]);

  const allDepartments = filters.departments.length === 0;

  // Начальнику одного отдела переключать нечего: «Вся компания» и «НО» — это
  // одна и та же цифра, и два одинаковых числа рядом читаются как ошибка.
  const showSwitcher = departments.length > 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="card p-2 flex flex-wrap items-center justify-between gap-2">
        {showSwitcher ? (
          <div className="bbc-scroll-x flex items-center gap-1 min-w-0">
            <DepartmentButton
              label="Вся компания"
              active={allDepartments}
              amount={totalDebt}
              onClick={() => {
                for (const code of filters.departments) onToggleFilter("departments", code);
              }}
            />
            {departments.map((code) => (
              <DepartmentButton
                key={code}
                label={code}
                title={department(code)?.name}
                active={filters.departments.includes(code)}
                amount={debtByDepartment.get(code) ?? 0}
                onClick={() => onToggleFilter("departments", code)}
              />
            ))}
          </div>
        ) : (
          <span className="text-xs px-1" style={{ color: "var(--text-secondary)" }}>
            {department(departments[0])?.name ?? "Все данные"}
          </span>
        )}

        {/* flex-wrap, а не shrink-0: втроём кнопки занимают 367px и на телефоне
            вылезали за правый край на два пикселя. Переносить их по одной
            честнее, чем прокручивать вбок ряд из трёх кнопок. */}
        <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
          {/* «Итоги» стоят здесь, а не над карточкой: это такое же действие над
              реестром, что и «Наши юрлица» с «Фильтром». Отдельно наверху они
              висели вторым, пустым рядом — и читались как заголовок, а не как
              кнопка. */}
          <button type="button" className="btn-ghost text-xs px-3 py-1.5" onClick={onTotals}>
            <PieChartIcon />
            Итоги
          </button>

          {firms.length > 1 ? (
            <div className="relative" ref={firmsRef}>
              <button
                type="button"
                className="btn-ghost text-xs px-3 py-1.5"
                onClick={() => setFirmsOpen((value) => !value)}
                aria-expanded={firmsOpen}
              >
                Наши юрлица
                {filters.firms.length ? (
                  <span className="badge badge-blue ml-1.5">{filters.firms.length}</span>
                ) : null}
              </button>
              {firmsOpen ? (
                <div
                  className="absolute right-0 z-20 mt-1 w-56 card p-1"
                  style={{ boxShadow: "var(--shadow-float)" }}
                >
                  {firms.map((firm) => (
                    <label
                      key={firm}
                      className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer rounded"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <input
                        type="checkbox"
                        checked={filters.firms.includes(firm)}
                        onChange={() => onToggleFilter("firms", firm)}
                      />
                      {firm}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className={open ? "btn-primary text-xs px-3 py-1.5" : "btn-ghost text-xs px-3 py-1.5"}
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
          >
            <SlidersIcon />
            Фильтр
            {activeFilterCount ? (
              <span className="badge badge-blue ml-1">{activeFilterCount}</span>
            ) : null}
          </button>
        </div>
      </div>

      {open ? (
        <div className="card p-3 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Клиент или договор</span>
              <input
                type="text"
                className="input-field text-xs"
                placeholder="Название или № договора"
                value={filters.search}
                onChange={(event) => onSearch(event.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Ответственный</span>
              <select
                className="input-field text-xs"
                value={filters.employees[0] ?? ""}
                onChange={(event) => {
                  for (const name of filters.employees) onToggleFilter("employees", name);
                  if (event.target.value) onToggleFilter("employees", event.target.value);
                }}
              >
                <option value="">Все</option>
                {employees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Долг от</span>
              <input
                type="number"
                min={0}
                step={50_000}
                className="input-field text-xs bbc-num"
                placeholder="0 ₸"
                value={minDebt || ""}
                onChange={(event) => onMinDebt(Number(event.target.value) || 0)}
              />
            </label>

            {/* Вместо светофора из макета — порог по возрасту. Цвет ничего не
                кодирует, а «больше 60 дней» это конкретное условие. */}
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Возраст</span>
              <button
                type="button"
                className={
                  overdueOnly ? "btn-primary text-xs py-1.5" : "btn-ghost text-xs py-1.5"
                }
                onClick={() => onOverdueOnly(!overdueOnly)}
                aria-pressed={overdueOnly}
              >
                Только старше 60 дней
              </button>
            </label>
          </div>

          <div className="flex justify-end mt-3">
            <button
              type="button"
              className="text-xs"
              style={{ color: "var(--text-accent)" }}
              onClick={() => {
                onClear();
                onMinDebt(0);
                onOverdueOnly(false);
              }}
            >
              Сбросить всё
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DepartmentButton({
  label,
  title,
  active,
  amount,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  amount: number;
  onClick: () => void;
}) {
  const short = useMemo(() => (amount ? `${money(Math.round(amount / 1000))} тыс` : "—"), [amount]);
  return (
    <button
      type="button"
      // shrink-0 обязателен: внутри горизонтального скроллера flex-элементы по
      // умолчанию сжимаются, и на телефоне кнопки отделов схлопывались в
      // нечитаемую кашу из наложенных друг на друга подписей.
      className={`shrink-0 px-3 py-1 rounded-[var(--radius-btn)] text-xs whitespace-nowrap transition-colors ${
        active ? "tab-active" : "tab-inactive"
      }`}
      onClick={onClick}
      title={title ? `${title} · ${money(amount)} ₸` : `${money(amount)} ₸`}
      aria-pressed={active}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-1.5 bbc-num" style={{ color: "var(--text-muted)" }}>
        {short}
      </span>
    </button>
  );
}
