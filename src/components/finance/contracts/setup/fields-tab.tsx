"use client";

/**
 * «Поля»: какие колонки есть у договора, в каком порядке и как подписаны.
 *
 * Один список управляет листом, карточкой, разбором Excel, выгрузкой и
 * правами на поля, поэтому правка здесь меняет всё сразу — после ответа
 * сервера схема перечитывается, и лист перестраивается сам.
 *
 * Системное поле можно переименовать и спрятать, но не убрать: на нём держатся
 * начисления, долги и отборы листов. Кнопка «Убрать» у него есть: запрос уходит
 * на сервер, и его отказ одной строкой встаёт под полем ровно тогда, когда
 * человек попробовал. Заранее написанное объяснение у каждой строки читали бы
 * один раз, а свой текст на клиенте однажды разошёлся бы с правилом сервера.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { type FieldType, type RegistryField, contractsApi } from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { ChoicePop } from "@/components/finance/contracts/setup/popover";
import { useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { CUSTOM_TYPES, TYPE_WORDS, hasValue } from "@/components/finance/contracts/setup/words";

const READ_ONLY = new Set(["paid_snapshot", "remaining_snapshot"]);

type Ask =
  | { kind: "archive"; field: RegistryField; count: number }
  | { kind: "type"; field: RegistryField; type: FieldType; count: number };

function inContracts(count: number): string {
  return `${count} ${plural(count, "договоре", "договорах", "договорах")}`;
}

export function FieldsTab() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<FieldType>("text");

  const fields = useMemo(
    () => [...(schema?.fields ?? [])].sort((a, b) => a.position - b.position),
    [schema],
  );

  // Сколько договоров держат значение поля — для «Значения в 212 договорах
  // уйдут вместе с ним». Считается по хранилищу: все договоры уже в браузере.
  const filled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contract of byId.values()) {
      if (contract.deleted) continue;
      for (const [key, value] of Object.entries(contract.values)) {
        if (hasValue(value)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [byId]);

  // Строка, которую подвинули с клавиатуры, после перестройки списка снова
  // в фокусе: иначе второй Alt+↓ подряд уходил бы в никуда.
  useEffect(() => {
    if (!focusKey) return;
    const row = document.querySelector<HTMLElement>(`[data-field-row="${CSS.escape(focusKey)}"]`);
    row?.focus({ preventScroll: false });
  }, [focusKey, fields]);

  if (!schema) return null;

  const move = (index: number, dir: -1 | 1) => {
    const field = fields[index];
    const target = index + dir;
    if (!field || target < 0 || target >= fields.length) return;
    // Сервер ставит поле «после такого-то»; `null` — в самое начало.
    const after = dir === -1 ? (index >= 2 ? fields[index - 2].key : null) : fields[index + 1].key;
    void action.run(`move:${field.key}`, () => contractsApi.setup.updateField(field.key, { after }));
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, index: number, key: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setFocusKey(key);
    move(index, event.key === "ArrowUp" ? -1 : 1);
  };

  const patch = (field: RegistryField, data: Record<string, unknown>, slot: string) => {
    void action.run(`${slot}:${field.key}`, () => contractsApi.setup.updateField(field.key, data));
  };

  const add = async () => {
    const clean = title.trim();
    if (!clean) return;
    const ok = await action.run("add", () => contractsApi.setup.addField(clean, type));
    if (ok) {
      setTitle("");
      setType("text");
    }
  };

  return (
    <div className="setup-fields">
      <div className="setup-fields-head" aria-hidden="true">
        <span />
        <span className="eyebrow">Поле</span>
        <span className="eyebrow">Тип</span>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div role="list" aria-label="Поля договора">
        {fields.map((field, index) => {
          const count = filled.get(field.key) ?? 0;
          const readOnly = READ_ONLY.has(field.key);
          const errors = [
            action.error(`move:${field.key}`),
            action.error(`required:${field.key}`),
            action.error(`hidden:${field.key}`),
            action.error(`type:${field.key}`),
            action.error(`archive:${field.key}`),
          ].filter(Boolean);
          return (
            <div
              key={field.key}
              role="listitem"
              tabIndex={0}
              data-field-row={field.key}
              className="setup-field"
              data-hidden={field.hidden ? "true" : undefined}
              aria-label={`${field.title}, ${index + 1} из ${fields.length}. Alt и стрелка — подвинуть`}
              onKeyDown={(event) => onRowKey(event, index, field.key)}
            >
              <span className="setup-field-move">
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Поднять «${field.title}»`}
                  disabled={index === 0 || action.busy(`move:${field.key}`)}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon size={16} />
                </button>
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Опустить «${field.title}»`}
                  disabled={index === fields.length - 1 || action.busy(`move:${field.key}`)}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon size={16} />
                </button>
              </span>
              <span className="setup-field-title">
                <InlineText
                  value={field.title}
                  label="Название поля"
                  trace={action.trace(`title:${field.key}`)}
                  error={action.error(`title:${field.key}`)}
                  onCommit={(next) =>
                    void action.run(`title:${field.key}`, () => contractsApi.setup.updateField(field.key, { title: next }))
                  }
                />
                {field.hidden ? <span className="setup-field-flag">спрятано</span> : null}
              </span>
              <span className="setup-field-type">
                {field.system ? (
                  <span className="annot">{TYPE_WORDS[field.type] ?? field.type}</span>
                ) : (
                  <span className="annot">
                    <ChoicePop
                      value={field.type}
                      options={CUSTOM_TYPES.map((item) => ({ value: item, label: TYPE_WORDS[item] }))}
                      label={`Тип поля «${field.title}»`}
                      disabled={action.busy(`type:${field.key}`)}
                      onPick={(next) => {
                        if (count > 0) setAsk({ kind: "type", field, type: next as FieldType, count });
                        else patch(field, { type: next }, "type");
                      }}
                    />
                  </span>
                )}
              </span>
              <span className="setup-field-kind">{field.system ? "системное" : "своё"}</span>
              <span className="setup-field-req">
                {readOnly ? (
                  <span className="setup-field-kind">только чтение</span>
                ) : (
                  <button
                    type="button"
                    className="setup-toggle"
                    aria-pressed={field.required}
                    disabled={action.busy(`required:${field.key}`)}
                    onClick={() => patch(field, { required: !field.required }, "required")}
                  >
                    обязательное
                  </button>
                )}
              </span>
              <span className="setup-field-hide">
                <button
                  type="button"
                  className="fin-link-btn"
                  disabled={action.busy(`hidden:${field.key}`)}
                  onClick={() => patch(field, { hidden: !field.hidden }, "hidden")}
                >
                  {field.hidden ? "Показать" : "Спрятать"}
                </button>
              </span>
              <span className="setup-field-drop">
                <button
                  type="button"
                  className="fin-link-btn setup-quiet"
                  disabled={action.busy(`archive:${field.key}`)}
                  onClick={() => {
                                    // Системное поле сервер не убирает — спрашиваем его сразу,
                    // без диалога: отказ приходит его словами под строкой, и
                    // правило живёт в одном месте, а не в двух текстах.
                    if (field.system) {
                      void action.run(`archive:${field.key}`, () =>
                        contractsApi.setup.updateField(field.key, { archived: true }),
                      );
                      return;
                    }
                    setAsk({ kind: "archive", field, count });
                  }}
                >
                  Убрать
                </button>
              </span>
              {errors.length ? (
                <span className="setup-field-note setup-error" role="alert">
                  {errors[0]}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <form
        className="setup-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <span className="setup-add-lead">+ Поле</span>
        <input
          type="text"
          className="setup-input"
          value={title}
          placeholder="Название"
          aria-label="Название нового поля"
          onChange={(event) => setTitle(event.target.value)}
        />
        <span className="setup-add-type">
          тип{" "}
          <ChoicePop
            value={type}
            options={CUSTOM_TYPES.map((item) => ({ value: item, label: TYPE_WORDS[item] }))}
            label="Тип нового поля"
            onPick={(next) => setType(next as FieldType)}
          />
        </span>
        <button type="submit" className="btn-primary btn-sm" disabled={!title.trim() || action.busy("add")}>
          Добавить
        </button>
        {action.error("add") ? (
          <span className="setup-error setup-add-error" role="alert">
            {action.error("add")}
          </span>
        ) : null}
      </form>

      <ConfirmDialog
        open={ask?.kind === "archive"}
        title={ask ? `Убрать поле «${ask.field.title}»?` : ""}
        text={
          ask && ask.count > 0
            ? `Значения в ${inContracts(ask.count)} уйдут вместе с ним.`
            : "В договорах оно пока не заполнено."
        }
        confirm="Убрать"
        danger
        busy={ask ? action.busy(`archive:${ask.field.key}`) : false}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (!ask) return;
          const field = ask.field;
          setAsk(null);
          void action.run(`archive:${field.key}`, () => contractsApi.setup.updateField(field.key, { archived: true }));
        }}
      />
      <ConfirmDialog
        open={ask?.kind === "type"}
        title={ask ? `Сменить тип поля «${ask.field.title}»?` : ""}
        text={
          ask?.kind === "type"
            ? `Значения в ${inContracts(ask.count)} останутся как записаны — к типу «${TYPE_WORDS[ask.type]}» они не приводятся.`
            : ""
        }
        confirm="Сменить"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (ask?.kind !== "type") return;
          const { field, type: next } = ask;
          setAsk(null);
          patch(field, { type: next }, "type");
        }}
      />
    </div>
  );
}
