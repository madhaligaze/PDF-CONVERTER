"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  type AccessCatalog,
  type AccessLevel,
  type ContractScope,
  type Grant,
  type GrantChange,
  type OwnEntity,
  type SubjectAccess,
  contractsApi,
  peopleApi,
} from "@/components/finance/api";
import { SelectLine } from "@/components/finance/ui/select-line";

/**
 * Права галочками — только не галочками (фронт-план, 6.9 «Люди · Права»).
 *
 * Уровень выбирается текстом в строку: «Нет · Видит · Правит». Два флажка
 * «видит» и «правит» допускали бы «правит, но не видит». Изменение уходит
 * сразу; под строкой прочерчивается линия сохранения, отказ — текстом.
 *
 * Режим отдела — одна колонка. Режим человека (карточка сотрудника →
 * «Доступ») — «у отдела» мелкой строкой под названием, «Лично» с первой
 * позицией «Как у отдела» и «Итог». Администратор и владелец видят вместо
 * матрицы одну строку: у них записей прав нет, они видят всё.
 */
type Kind = "department" | "employee";
type Choice = AccessLevel | "inherit";

const LEVEL_WORDS: Record<AccessLevel, string> = { none: "Нет", view: "Видит", edit: "Правит" };
const FIELD_WORDS: Record<AccessLevel, string> = { none: "Скрыто", view: "Видит", edit: "Правит" };
const ROW_WORDS = { all: "все", department: "своего отдела", own: "где ответственный" } as const;

let catalogCache: Promise<AccessCatalog> | null = null;
export function loadCatalog(): Promise<AccessCatalog> {
  if (!catalogCache) {
    catalogCache = peopleApi.access.catalog().catch((exc) => {
      catalogCache = null;
      throw exc;
    });
  }
  return catalogCache;
}

export function LevelSwitch({
  value,
  levels,
  words = LEVEL_WORDS,
  inherit,
  onChange,
  label,
  disabled,
}: {
  value: Choice;
  levels: AccessLevel[];
  words?: Record<AccessLevel, string>;
  /** Есть — первой позицией «Как у отдела». */
  inherit?: boolean;
  onChange: (next: Choice) => void;
  label: string;
  disabled?: boolean;
}) {
  const items = [
    ...(inherit ? [{ key: "inherit" as Choice, label: "Как у отдела" }] : []),
    ...levels.map((level) => ({ key: level as Choice, label: words[level] })),
  ];
  return (
    <SelectLine
      items={items}
      value={value}
      onChange={onChange}
      role="radiogroup"
      label={label}
      size="sm"
      disabled={disabled}
      className="cab-level"
    />
  );
}

type RowState = { sending?: boolean; error?: string };

export function RightsMatrix({ kind, id, readOnly = false }: { kind: Kind; id: string; readOnly?: boolean }) {
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const [data, setData] = useState<SubjectAccess | null>(null);
  const [entities, setEntities] = useState<OwnEntity[]>([]);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [pickEntities, setPickEntities] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    Promise.all([loadCatalog(), peopleApi.access.get(kind, id), contractsApi.schema().catch(() => null)])
      .then(([nextCatalog, nextData, schema]) => {
        if (!alive) return;
        setCatalog(nextCatalog);
        setData(nextData);
        setEntities(schema?.own_entities ?? []);
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Права не прочитались"));
    return () => {
      alive = false;
    };
  }, [kind, id]);

  const save = useCallback(
    async (resource: string, change: GrantChange) => {
      setRows((prev) => ({ ...prev, [resource]: { sending: true } }));
      try {
        const next = await peopleApi.access.put(kind, id, { [resource]: change });
        setData(next);
        setRows((prev) => ({ ...prev, [resource]: {} }));
      } catch (exc) {
        setRows((prev) => ({
          ...prev,
          [resource]: { error: exc instanceof Error ? exc.message : "Не сохранилось" },
        }));
      }
    },
    [kind, id],
  );

  const groups = useMemo(() => {
    const out: { title: string; items: AccessCatalog["resources"] }[] = [];
    for (const item of catalog?.resources ?? []) {
      const last = out[out.length - 1];
      if (last && last.title === item.group) last.items.push(item);
      else out.push({ title: item.group, items: [item] });
    }
    return out;
  }, [catalog]);

  if (error) return <p className="cab-error fin-fail">{error}</p>;
  if (!catalog || !data) return <p className="cab-wait">Читаем права…</p>;
  if (data.subject.admin) {
    return <p className="cab-admin-line">Администратор видит и правит всё.</p>;
  }

  const person = kind === "employee";
  const own = data.grants;
  const dept = data.department_grants ?? {};
  const deptTitle = data.subject.department?.code ?? "";

  const choiceOf = (resource: string): Choice => {
    const grant = own[resource];
    if (person) return grant ? grant.level : "inherit";
    // Поле договора без записи — «как у договоров», а не «скрыто».
    if (!grant && resource.startsWith("contracts.field.")) return data.effective[resource] ?? contractsLevel;
    return grant?.level ?? "none";
  };

  const contractsGrant: Grant | undefined = own.contracts ?? (person ? dept.contracts : undefined);
  const scopeInherited = person && !own.contracts;
  const scope: ContractScope = contractsGrant?.scope ?? {};
  const contractsLevel = data.effective.contracts ?? "none";

  const setScope = (next: ContractScope) => {
    const level = own.contracts?.level ?? (person ? dept.contracts?.level : undefined) ?? "view";
    void save("contracts", { level, scope: { rows: scope.rows ?? "all", entities: scope.entities ?? [], ...next } });
  };

  const renderRow = (resource: string, title: string, levels: AccessLevel[], words = LEVEL_WORDS, note?: string) => {
    const state = rows[resource] ?? {};
    const deptLevel = dept[resource]?.level ?? (resource.startsWith("contracts.field.") ? null : "none");
    return (
      <div className="cab-right" key={resource} data-sending={state.sending ? "true" : undefined}>
        <span className="cab-right-title">
          {title}
          {note ? <span className="annot cab-right-note">{note}</span> : null}
          {person ? (
            <span className="cab-right-sub fin-soft">
              у отдела{deptTitle ? ` ${deptTitle}` : ""}: {deptLevel ? words[deptLevel as AccessLevel] : "как у договоров"}
            </span>
          ) : null}
        </span>
        <LevelSwitch
          value={choiceOf(resource)}
          levels={levels}
          words={words}
          inherit={person}
          label={title}
          disabled={readOnly || state.sending}
          onChange={(next) => void save(resource, next === "inherit" ? null : next)}
        />
        {person ? (
          <span className="cab-right-total" aria-label="Итог">
            {words[(data.effective[resource] ?? "none") as AccessLevel]}
          </span>
        ) : null}
        <span className="cab-trace" aria-hidden="true" />
        {state.error ? <span className="cab-line-error fin-fail">{state.error}</span> : null}
      </div>
    );
  };

  return (
    <div className="cab-rights" data-person={person ? "true" : undefined}>
      {person ? (
        <div className="cab-right cab-right-head" aria-hidden="true">
          <span />
          <span className="eyebrow">Лично</span>
          <span className="eyebrow cab-right-total">Итог</span>
        </div>
      ) : null}
      {groups.map((group) => (
        <Fragment key={group.title}>
          <p className="cab-rights-group eyebrow">{group.title}</p>
          {group.items.map((item) => (
            <Fragment key={item.key}>
              {renderRow(item.key, item.title, item.levels, LEVEL_WORDS, item.note)}
              {item.key === "contracts" && contractsLevel !== "none" ? (
                <div className="cab-right-more">
                  <div className="cab-right cab-right-sub-row">
                    <span className="cab-right-title">
                      Какие договоры
                      {scopeInherited ? <span className="cab-right-sub fin-soft">как у отдела</span> : null}
                    </span>
                    <SelectLine
                      items={(catalog.row_scopes ?? ["all", "department", "own"]).map((key) => ({
                        key,
                        label: ROW_WORDS[key],
                      }))}
                      value={scope.rows ?? "all"}
                      onChange={(rowsScope) => setScope({ rows: rowsScope })}
                      role="radiogroup"
                      label="Какие договоры"
                      size="sm"
                      disabled={readOnly || scopeInherited || rows.contracts?.sending}
                      className="cab-level"
                    />
                  </div>
                  <div className="cab-right cab-right-sub-row">
                    <span className="cab-right-title">Какими юрлицами</span>
                    <span className="cab-entities">
                      <SelectLine
                        items={[
                          { key: "all", label: "все" },
                          { key: "pick", label: "выбрать…" },
                        ]}
                        value={(scope.entities?.length ?? 0) > 0 || pickEntities ? "pick" : "all"}
                        onChange={(next) => {
                          if (next === "all") {
                            setPickEntities(false);
                            setScope({ entities: [] });
                          } else setPickEntities(true);
                        }}
                        role="radiogroup"
                        label="Какими юрлицами"
                        size="sm"
                        disabled={readOnly || scopeInherited || entities.length === 0}
                        className="cab-level"
                      />
                      {(scope.entities?.length ?? 0) > 0 || pickEntities ? (
                        <span className="cab-entity-list">
                          {entities.map((entity) => {
                            const on = scope.entities?.includes(entity.id) ?? false;
                            return (
                              <button
                                key={entity.id}
                                type="button"
                                className="cab-toggle"
                                aria-pressed={on}
                                disabled={readOnly || scopeInherited}
                                onClick={() => {
                                  const current = scope.entities ?? [];
                                  setScope({
                                    entities: on ? current.filter((item) => item !== entity.id) : [...current, entity.id],
                                  });
                                }}
                              >
                                {entity.code || entity.name}
                              </button>
                            );
                          })}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {catalog.fields.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="fin-link-btn cab-right-fold"
                        aria-expanded={fieldsOpen}
                        onClick={() => setFieldsOpen((value) => !value)}
                      >
                        Поля договора {fieldsOpen ? "⌃" : "⌄"}
                      </button>
                      {fieldsOpen
                        ? catalog.fields.map((field) => renderRow(field.key, field.title, field.levels, FIELD_WORDS))
                        : null}
                    </>
                  ) : null}
                  {rows.contracts?.error ? <p className="cab-line-error fin-fail">{rows.contracts.error}</p> : null}
                </div>
              ) : null}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
