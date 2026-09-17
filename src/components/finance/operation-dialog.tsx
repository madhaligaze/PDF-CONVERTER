"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CloseIcon } from "@/components/icons";
import {
  type Dictionaries,
  type Operation,
  type OperationKind,
  financeApi,
  todayIso,
} from "@/components/finance/api";

type Props = {
  kind: OperationKind;
  dictionaries: Dictionaries;
  /** Правка существующей операции; пусто — создание новой. */
  operation?: Operation | null;
  onClose: () => void;
  onSaved: () => void;
};

const TITLES: Record<OperationKind, string> = {
  income: "Поступление",
  expense: "Списание",
  transfer: "Перевод между счетами",
};

/**
 * Карточка операции.
 *
 * Полей много, но открыто ровно четыре: счёт, сумма, категория, контрагент, и
 * дата. Остальное — за строкой «Ещё»: дата сделки, период начисления, проект,
 * теги, состояние «это ожидание». Так устроены формы во всех продуктах учёта, и
 * причина не в экономии места: человек заводит операцию десятки раз в день, и
 * каждое лишнее поле в поле зрения — это лишняя пауза.
 *
 * Дата сделки не «дополнительное поле для порядка». Она разводит два отчёта:
 * деньги считаются по дате платежа, прибыль — по дате сделки. Поэтому под ней
 * стоит подпись, объясняющая последствие, а не название.
 */
export function OperationDialog({ kind, dictionaries, operation, onClose, onSaved }: Props) {
  const isTransfer = kind === "transfer";
  const side = kind === "income" ? "income" : "expense";
  const categories = useMemo(
    () => dictionaries.categories.filter((item) => item.side === side),
    [dictionaries.categories, side],
  );

  const [accountFrom, setAccountFrom] = useState(operation?.account_from_id ?? "");
  const [accountTo, setAccountTo] = useState(operation?.account_to_id ?? "");
  const [amount, setAmount] = useState(operation?.amount ?? "");
  const [categoryId, setCategoryId] = useState(operation?.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(operation?.counterparty_id ?? "");
  const [paidAt, setPaidAt] = useState(operation?.paid_at ?? todayIso());
  const [accruedAt, setAccruedAt] = useState(operation?.accrued_at ?? "");
  const [projectId, setProjectId] = useState(operation?.projects?.[0]?.id ?? "");
  const [comment, setComment] = useState(operation?.comment ?? "");
  const [status, setStatus] = useState<"fact" | "plan">(operation?.status ?? "fact");
  const [more, setMore] = useState(Boolean(operation?.accrued_at || operation?.projects?.length));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstField = useRef<HTMLSelectElement | null>(null);
  // Какое поле ловит фокус: у поступления это «На счёт», у остальных — «Со
  // счёта». Считается здесь, а не в разметке: внутри ветки условия TypeScript
  // уже сузил `kind`, и сравнение там выглядит как заведомо ложное.
  const focusOn: "from" | "to" = kind === "income" ? "to" : "from";

  // Первое поле в фокусе: форму открывают с клавиатуры и заполняют не глядя.
  useEffect(() => {
    firstField.current?.focus();
  }, []);

  // Esc закрывает — как в остальных окнах приложения.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        kind,
        status,
        paid_at: paidAt,
        accrued_at: accruedAt || null,
        amount: amount.replace(/\s/g, "").replace(",", "."),
        account_from_id: isTransfer || kind === "expense" ? accountFrom || null : null,
        account_to_id: isTransfer || kind === "income" ? accountTo || null : null,
        category_id: isTransfer ? null : categoryId || null,
        counterparty_id: isTransfer ? null : counterpartyId || null,
        comment,
        projects: projectId
          ? [{ project_id: projectId, amount: amount.replace(/\s/g, "").replace(",", ".") }]
          : [],
      };
      if (operation) await financeApi.patchOperation(operation.id, { ...body, version: operation.version });
      else await financeApi.createOperation(body);
      onSaved();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="card w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-4 sm:p-5"
        style={{ boxShadow: "var(--shadow-float)" }}
        role="dialog"
        aria-label={TITLES[kind]}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {operation ? "Правка операции" : TITLES[kind]}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Закрыть">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {(isTransfer || kind === "expense") && (
            <label className="flex flex-col gap-1">
              <span className="eyebrow">Со счёта</span>
              <select
                ref={focusOn === "from" ? firstField : undefined}
                className="input-field"
                value={accountFrom}
                onChange={(event) => setAccountFrom(event.target.value)}
              >
                <option value="">Выберите счёт</option>
                {dictionaries.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {(isTransfer || kind === "income") && (
            <label className="flex flex-col gap-1">
              <span className="eyebrow">На счёт</span>
              <select
                ref={focusOn === "to" ? firstField : undefined}
                className="input-field"
                value={accountTo}
                onChange={(event) => setAccountTo(event.target.value)}
              >
                <option value="">Выберите счёт</option>
                {dictionaries.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="eyebrow">Сумма</span>
            <input
              className="input-field fin-num"
              style={{ textAlign: "left" }}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </label>

          {!isTransfer && (
            <>
              <label className="flex flex-col gap-1">
                <span className="eyebrow">Категория</span>
                <select
                  className="input-field"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Без категории</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Контрагент</span>
                <select
                  className="input-field"
                  value={counterpartyId}
                  onChange={(event) => setCounterpartyId(event.target.value)}
                >
                  <option value="">Без контрагента</option>
                  {dictionaries.counterparties.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="flex flex-col gap-1">
            <span className="eyebrow">Дата платежа</span>
            <input
              className="input-field"
              type="date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
            />
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={status === "plan"}
              onChange={(event) => setStatus(event.target.checked ? "plan" : "fact")}
            />
            Это ожидание, деньги ещё не двигались
          </label>

          {!more ? (
            <button type="button" className="fin-chip self-start" onClick={() => setMore(true)}>
              Ещё: дата сделки, проект, комментарий
            </button>
          ) : (
            <>
              {!isTransfer && (
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Дата сделки</span>
                  <input
                    className="input-field"
                    type="date"
                    value={accruedAt}
                    onChange={(event) => setAccruedAt(event.target.value)}
                  />
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Отчёт «Прибыль» посчитает операцию по этой дате, а «Деньги» — по дате
                    платежа. Разница между отчётами и есть долг.
                  </span>
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Проект</span>
                <select
                  className="input-field"
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">Без проекта</option>
                  {dictionaries.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="eyebrow">Комментарий</span>
                <textarea
                  className="input-field"
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Например, номер договора"
                />
              </label>
            </>
          )}

          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
              {busy ? "Сохраняем…" : operation ? "Сохранить" : "Записать"}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
