"use client";

/**
 * Сотрудники: кого заводим, что ему видно и чьих клиентов.
 *
 * Три независимые оси, и на экране они разведены нарочно — склеенные в одну
 * «роль» они однажды разъедутся, и никто не заметит:
 *
 *   • разделы   — что вообще открывается;
 *   • отделы    — чьи строки в принципе доступны;
 *   • область   — «только свои» / «весь отдел» / «все».
 *
 * Роль-пресет только проставляет галочки. Сервер хранит и проверяет итоговый
 * набор, а не имя роли: иначе переименование пресета молча меняло бы права
 * всем, кому он когда-то был выбран.
 *
 * Пароль показывается один раз и больше нигде: в базе argon2-хеш, узнать его
 * повторно нельзя — можно только сбросить.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { CloseIcon } from "@/components/icons";
import {
  BbcApiError,
  createEmployee,
  deleteEmployee,
  dismissEmployee,
  fetchEmployeeAliases,
  fetchEmployees,
  resetEmployeePassword,
  restoreEmployee,
  updateEmployee,
} from "../api";
import { ConfirmDialog } from "../confirm-dialog";
import { plural } from "../format";
import { CheckIcon, CopyIcon, LockIcon, UserIcon } from "../icon";
import type {
  BbcDataScope,
  BbcEmployee,
  BbcEmployeeAlias,
  BbcEmployeeForm,
  BbcEmployeesPayload,
  BbcRolePreset,
} from "../types";

import { blockTitle } from "../shell/nav-items";

const SCOPE_TITLES: Record<BbcDataScope, { name: string; hint: string }> = {
  own: { name: "Только свои клиенты", hint: "по колонке «Сотрудник» в таблице" },
  department: { name: "Весь отдел", hint: "все должники своих отделов" },
  all: { name: "Все клиенты", hint: "весь дашборд, кроме управления доступом" },
};

const EMPTY_FORM: BbcEmployeeForm = {
  username: "",
  full_name: "",
  departments: [],
  blocks: ["receivables", "touches"],
  data_scope: "own",
  employee_aliases: [],
};

export function Employees() {
  const [payload, setPayload] = useState<BbcEmployeesPayload | null>(null);
  const [aliases, setAliases] = useState<BbcEmployeeAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BbcEmployee | null>(null);
  const [issued, setIssued] = useState<{ login: string; password: string } | null>(null);
  /** Сотрудник, по которому открыт вопрос «точно?». `kind` — что именно. */
  const [pending, setPending] = useState<{ employee: BbcEmployee; kind: "dismiss" | "delete" } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPayload(await fetchEmployees());
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось прочитать список");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Написания из колонки «Сотрудник». Отказ молчаливый: список — подсказка,
    // а не условие; без него можно вписать имя руками.
    void fetchEmployeeAliases()
      .then((data) => setAliases(data.names))
      .catch(() => setAliases([]));
  }, [load]);

  const active = useMemo(
    () => (payload?.employees ?? []).filter((item) => item.status !== "dismissed"),
    [payload],
  );
  const dismissed = useMemo(
    () => (payload?.employees ?? []).filter((item) => item.status === "dismissed"),
    [payload],
  );

  async function run(action: () => Promise<unknown>, onPassword?: (login: string, pw: string) => void) {
    setError(null);
    try {
      const result = (await action()) as { temp_password?: string; employee?: BbcEmployee } | undefined;
      if (result?.temp_password && result.employee && onPassword) {
        onPassword(result.employee.username, result.temp_password);
      }
      await load();
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не получилось");
    }
  }

  return (
    <section className="card bbc-grain relative p-5">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Сотрудники
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            Заходят по своему логину и видят только то, что здесь отмечено.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-xs px-3 py-2"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          <UserIcon size={14} />
          Добавить
        </button>
      </div>

      {error ? (
        <p
          className="text-xs px-3 py-2 rounded-lg mb-3"
          style={{
            color: "var(--accent-rose)",
            background: "var(--outflow-bg)",
            border: "1px solid var(--outflow-border)",
          }}
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mono-meta">Загрузка…</p>
      ) : !active.length && !dismissed.length ? (
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          Пока никого. Добавьте первого — например, бухгалтера, который ведёт своих должников.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {active.map((item) => (
            <EmployeeCard
              key={item.id}
              employee={item}
              onEdit={() => {
                setEditing(item);
                setEditorOpen(true);
              }}
              onReset={() =>
                run(() => resetEmployeePassword(item.id), (login, pw) =>
                  setIssued({ login, password: pw }),
                )
              }
              onDismiss={() => setPending({ employee: item, kind: "dismiss" })}
            />
          ))}

          {dismissed.length ? (
            <>
              <p className="eyebrow mt-3">Уволенные</p>
              {dismissed.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: "var(--bg-active)", opacity: 0.7 }}
                >
                  <span className="text-sm min-w-0 truncate" style={{ color: "var(--text-secondary)" }}>
                    {item.full_name}
                  </span>
                  <span className="mono-meta shrink-0">{item.username}</span>
                  <span className="ml-auto flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="btn-ghost bbc-micro px-2 py-1"
                      onClick={() =>
                        run(() => restoreEmployee(item.id), (login, pw) =>
                          setIssued({ login, password: pw }),
                        )
                      }
                    >
                      Вернуть
                    </button>
                    <button
                      type="button"
                      className="btn-ghost bbc-micro px-2 py-1"
                      style={{ color: "var(--accent-rose)" }}
                      onClick={() => setPending({ employee: item, kind: "delete" })}
                    >
                      Удалить
                    </button>
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}

      {editorOpen && payload ? (
        <EmployeeEditor
          employee={editing}
          presets={payload.presets}
          departments={payload.departments}
          blocks={payload.blocks}
          adminBlocks={payload.admin_blocks ?? []}
          aliases={aliases}
          onClose={() => setEditorOpen(false)}
          onSaved={async (login, password) => {
            setEditorOpen(false);
            if (password) setIssued({ login, password });
            await load();
          }}
        />
      ) : null}

      {issued ? <PasswordOnce {...issued} onClose={() => setIssued(null)} /> : null}

      <ConfirmDialog
        open={!!pending}
        title={
          pending?.kind === "delete"
            ? `Удалить ${pending.employee.full_name} насовсем?`
            : `Уволить ${pending?.employee.full_name}?`
        }
        body={
          pending?.kind === "delete"
            ? "Учётная запись исчезнет. Касания останутся в журнале с его именем — история работы по долгам не должна зависеть от того, кто уже уволился."
            : "Войти он больше не сможет, но останется в списке уволенных, и все его касания сохранятся. Вернуть можно в любой момент — с новым паролем."
        }
        confirmLabel={pending?.kind === "delete" ? "Удалить" : "Уволить"}
        destructive
        onConfirm={() => {
          if (!pending) return;
          const { employee, kind } = pending;
          setPending(null);
          void run(() => (kind === "delete" ? deleteEmployee(employee.id) : dismissEmployee(employee.id)));
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  );
}

function EmployeeCard({
  employee,
  onEdit,
  onReset,
  onDismiss,
}: {
  employee: BbcEmployee;
  onEdit: () => void;
  onReset: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="card-inner p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
        <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {employee.full_name}
        </span>
        <span className="mono-meta">{employee.username}</span>
        {/* Не статус-точка: подпись только тогда, когда есть что сказать. */}
        {employee.must_change_password ? (
          <span className="bbc-micro" style={{ color: "var(--accent-amber)" }}>
            ещё не менял пароль
          </span>
        ) : null}
      </div>

      <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {employee.departments.join(", ") || "без отдела"} ·{" "}
        {SCOPE_TITLES[employee.data_scope]?.name ?? employee.data_scope}
        {employee.data_scope === "own" && employee.employee_aliases.length
          ? ` (${employee.employee_aliases.join(", ")})`
          : ""}
      </p>

      <p className="bbc-micro" style={{ color: "var(--text-muted)" }}>
        {employee.blocks.map((key) => blockTitle(key)).join(" · ")}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-ghost bbc-micro px-2 py-1" onClick={onEdit}>
          Настроить
        </button>
        <button type="button" className="btn-ghost bbc-micro px-2 py-1" onClick={onReset}>
          Сбросить пароль
        </button>
        <button
          type="button"
          className="btn-ghost bbc-micro px-2 py-1"
          style={{ color: "var(--accent-rose)" }}
          onClick={onDismiss}
        >
          Уволить
        </button>
      </div>
    </div>
  );
}

function EmployeeEditor({
  employee,
  presets,
  departments,
  blocks,
  adminBlocks,
  aliases,
  onClose,
  onSaved,
}: {
  employee: BbcEmployee | null;
  presets: BbcRolePreset[];
  departments: string[];
  blocks: string[];
  adminBlocks: string[];
  aliases: BbcEmployeeAlias[];
  onClose: () => void;
  onSaved: (login: string, password?: string) => void | Promise<void>;
}) {
  const [form, setForm] = useState<BbcEmployeeForm>(
    employee
      ? {
          full_name: employee.full_name,
          departments: employee.departments,
          blocks: employee.blocks,
          data_scope: employee.data_scope,
          employee_aliases: employee.employee_aliases,
        }
      : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(next: Partial<BbcEmployeeForm>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function toggle(key: "departments" | "blocks" | "employee_aliases", value: string) {
    setForm((current) => {
      const list = current[key];
      return {
        ...current,
        [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (employee) {
        await updateEmployee(employee.id, form);
        await onSaved(employee.username);
      } else {
        const created = await createEmployee(form);
        await onSaved(created.employee.username, created.temp_password);
      }
    } catch (err) {
      setError(err instanceof BbcApiError ? err.message : "Не удалось сохранить");
      setBusy(false);
    }
  }

  return (
    <div className="card-inner p-4 mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {employee ? `Настройки: ${employee.full_name}` : "Новый сотрудник"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="btn-ghost flex items-center justify-center"
          style={{ width: 32, height: 32, padding: 0 }}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 min-w-0">
            <span className="eyebrow">Имя</span>
            <input
              className="input-field"
              value={form.full_name}
              onChange={(event) => patch({ full_name: event.target.value })}
              placeholder="Дана Жумабекова"
              required
            />
          </label>

          {employee ? (
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="eyebrow">Логин</span>
              <p className="mono-meta py-2">{employee.username}</p>
            </div>
          ) : (
            <label className="flex flex-col gap-1.5 min-w-0">
              <span className="eyebrow">Логин</span>
              <input
                className="input-field"
                value={form.username ?? ""}
                onChange={(event) => patch({ username: event.target.value })}
                placeholder="dana"
                autoComplete="off"
                required
              />
            </label>
          )}
        </div>

        {/* Пресет только заполняет галочки ниже. В базу уходит их итог. */}
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">Готовая роль</span>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                className="btn-ghost bbc-micro px-2.5 py-1.5"
                title={preset.description}
                onClick={() => patch({ blocks: preset.blocks, data_scope: preset.data_scope })}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="eyebrow">Отделы</legend>
          <div className="flex flex-wrap gap-2">
            {departments.map((code) => (
              <Check
                key={code}
                label={code}
                checked={form.departments.includes(code)}
                onChange={() => toggle("departments", code)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="eyebrow">Разделы</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
            {blocks.map((key) => (
              <Check
                key={key}
                label={blockTitle(key)}
                checked={form.blocks.includes(key)}
                onChange={() => toggle("blocks", key)}
              />
            ))}
          </div>
          {/* Раньше эти галочки стояли здесь же, рядом с «Дебиторкой», и одна
              из них открывала сотруднику ФОТ всей компании с фамилиями. Ни
              журнал, ни лист ОМиП не режутся по отделу — резать в них нечем,
              — поэтому раздела больше нет в списке, и сказано почему. */}
          {adminBlocks.length ? (
            <p className="bbc-micro" style={{ color: "var(--text-muted)" }}>
              Только администратору: {adminBlocks.map((key) => blockTitle(key)).join(", ")} — эти
              листы не делятся по отделам, и выдать их частично нельзя.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="eyebrow">Каких клиентов видит</legend>
          <div className="flex flex-col gap-1">
            {(Object.keys(SCOPE_TITLES) as BbcDataScope[]).map((key) => (
              <label key={key} className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="data_scope"
                  checked={form.data_scope === key}
                  onChange={() => patch({ data_scope: key })}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span style={{ color: "var(--text-primary)" }}>{SCOPE_TITLES[key].name}</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>— {SCOPE_TITLES[key].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Написания из таблицы. Список, а не ввод: в книге встречаются «Дана»,
            «Дана Ж.» и «Жумабекова Д.», угадать их с клавиатуры нельзя.

            Рядом с каждым — его отделы и число клиентов. Без этого админ
            собирает учётку вслепую: отметив человека из НО и выдав отдел ОБО,
            он получит пустое пересечение — аккаунт выглядит рабочим и не
            показывает ни одной строки. */}
        {form.data_scope === "own" ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="eyebrow">Как он записан в колонке «Сотрудник»</legend>
            {aliases.length ? (
              <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
                {aliases.map((alias) => (
                  <AliasRow
                    key={alias.name}
                    alias={alias}
                    checked={form.employee_aliases.includes(alias.name)}
                    // Отдел не пересекается с выданными — отмечать можно, но
                    // человек должен видеть, что строк за этим не будет.
                    orphan={
                      form.departments.length > 0 &&
                      !alias.departments.some((code) => form.departments.includes(code))
                    }
                    onChange={() => toggle("employee_aliases", alias.name)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Список имён из таблицы сейчас недоступен. Попробуйте обновить страницу.
              </p>
            )}
            <ScopePreview form={form} aliases={aliases} />
          </fieldset>
        ) : null}

        {error ? (
          <p
            className="text-xs px-3 py-2 rounded-lg"
            style={{
              color: "var(--accent-rose)",
              background: "var(--outflow-bg)",
              border: "1px solid var(--outflow-border)",
            }}
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button type="submit" className="btn-primary text-xs px-4 py-2" disabled={busy}>
            <CheckIcon size={14} />
            {busy ? "Сохраняем…" : employee ? "Сохранить" : "Создать и выдать пароль"}
          </button>
          <button type="button" className="btn-ghost text-xs px-4 py-2" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </div>
  );
}

/** Одно написание из таблицы: имя, его отделы и сколько за ним клиентов. */
function AliasRow({
  alias,
  checked,
  orphan,
  onChange,
}: {
  alias: BbcEmployeeAlias;
  checked: boolean;
  orphan: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer min-w-0 py-0.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="shrink-0" />
      <span
        className="truncate min-w-0"
        style={{ color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}
      >
        {alias.name}
      </span>
      <span className="bbc-micro shrink-0" style={{ color: "var(--text-muted)" }}>
        {alias.departments.join(", ") || "без отдела"} · {alias.clients}{" "}
        {plural(alias.clients, "клиент", "клиента", "клиентов")}
      </span>
      {/* Цвет только на несовпадении. Подтверждать «всё хорошо» цветом нечего. */}
      {orphan && checked ? (
        <span className="bbc-micro shrink-0 ml-auto" style={{ color: "var(--accent-amber)" }}>
          не в выданных отделах
        </span>
      ) : null}
    </label>
  );
}

/**
 * Что реально увидит сотрудник при текущих галочках.
 *
 * Считается прямо здесь, до сохранения: пустой аккаунт выглядит рабочим, и
 * узнать о нём иначе можно только от самого сотрудника через неделю.
 */
function ScopePreview({
  form,
  aliases,
}: {
  form: BbcEmployeeForm;
  aliases: BbcEmployeeAlias[];
}) {
  if (!form.employee_aliases.length) {
    return (
      <p className="bbc-micro" style={{ color: "var(--accent-amber)" }}>
        Отметьте хотя бы одно — иначе сотруднику не будет видно ни одной строки.
      </p>
    );
  }

  const matched = aliases.filter(
    (alias) =>
      form.employee_aliases.includes(alias.name) &&
      (!form.departments.length ||
        alias.departments.some((code) => form.departments.includes(code))),
  );
  const clients = matched.reduce((sum, alias) => sum + alias.clients, 0);

  if (!clients) {
    return (
      <p className="bbc-micro" style={{ color: "var(--accent-rose)" }}>
        Ни одно из отмеченных имён не встречается в выданных отделах — сотрудник увидит пустой
        экран. Проверьте отделы выше.
      </p>
    );
  }

  return (
    <p className="bbc-micro" style={{ color: "var(--text-muted)" }}>
      Увидит примерно {clients} {plural(clients, "клиента", "клиентов", "клиентов")}.
    </p>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs cursor-pointer min-w-0">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="truncate" style={{ color: checked ? "var(--text-primary)" : "var(--text-secondary)" }}>
        {label}
      </span>
    </label>
  );
}

/**
 * Пароль, показанный один раз.
 *
 * Это не украшение и не «для удобства»: в базе лежит argon2-хеш, и повторно
 * узнать пароль нельзя ни через какой экран. Поэтому окно говорит об этом прямо,
 * а не мелким шрифтом — закрыть его, не скопировав, значит идти на сброс.
 */
function PasswordOnce({
  login,
  password,
  onClose,
}: {
  login: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="card-inner p-4 mt-4" style={{ borderColor: "var(--accent-border)" }} role="status">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Пароль для {login}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="btn-ghost flex items-center justify-center"
          style={{ width: 32, height: 32, padding: 0 }}
        >
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <code
          className="mono-meta px-3 py-2 rounded-lg select-all"
          style={{ background: "var(--bg-active)", fontSize: "1rem", letterSpacing: "0.06em" }}
        >
          {password}
        </code>
        <button
          type="button"
          className="btn-ghost text-xs px-3 py-2"
          onClick={async () => {
            await navigator.clipboard.writeText(password);
            setCopied(true);
          }}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? "Скопировано" : "Копировать"}
        </button>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        <LockIcon size={12} /> Покажем только сейчас — в базе лежит только хеш. Передайте пароль
        лично; при первом входе сотрудник обязан сменить его на свой.
      </p>
    </div>
  );
}
