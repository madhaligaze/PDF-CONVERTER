"use client";

import { useState } from "react";
import type { OCRMappingTemplate, OCRRuleManagerSnapshot, OCRRuleVersionDiff } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

type Props = {
  snapshot: OCRRuleManagerSnapshot | null;
  loading: boolean;
  onToggle: (template: OCRMappingTemplate, isActive: boolean) => void;
  onRollback: (template: OCRMappingTemplate) => void;
  onCompare: (template: OCRMappingTemplate) => Promise<OCRRuleVersionDiff | null>;
};

export function RuleManagerPanel({ snapshot, loading, onToggle, onRollback, onCompare }: Props) {
  const [diffs, setDiffs] = useState<Record<string, OCRRuleVersionDiff | null>>({});

  if (!snapshot || Object.keys(snapshot.grouped_versions).length === 0) {
    return (
      <SectionCard title="Правила OCR" subtitle="Сохранённые шаблоны сопоставления">
        <p className="text-sm py-3 text-center" style={{ color: "var(--text-muted)" }}>
          Правил OCR ещё нет.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Правила OCR" subtitle="Версии, статус и откат">
      <div className="space-y-4">
        {Object.entries(snapshot.grouped_versions).map(([name, versions]) => (
          <div key={name} className="card-inner p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {name}
              </p>
              <span className="badge badge-slate">{versions.length} версий</span>
            </div>
            <div className="space-y-2">
              {versions.map((tpl) => (
                <div
                  key={tpl.template_id}
                  className="rounded-[var(--radius-inner)] px-3 py-2.5"
                  style={{
                    background: "var(--bg-base)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          v{tpl.version}
                        </span>
                        <span className={`badge text-[0.6rem] ${tpl.is_active ? "badge-blue" : "badge-slate"}`}>
                          {tpl.is_active ? "активен" : "отключён"}
                        </span>
                      </div>
                      <p
                        className="mt-0.5 text-xs truncate max-w-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {tpl.header_signature.slice(0, 4).join(", ") || "без заголовков"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        className="btn-ghost text-xs px-2.5 py-1"
                        disabled={loading || tpl.version <= 1}
                        onClick={() => onRollback(tpl)}
                        type="button"
                      >
                        Откат
                      </button>
                      <button
                        className="btn-ghost text-xs px-2.5 py-1"
                        disabled={loading || tpl.version <= 1}
                        onClick={async () => {
                          const diff = await onCompare(tpl);
                          setDiffs((prev) => ({ ...prev, [tpl.template_id]: diff }));
                        }}
                        type="button"
                      >
                        Сравнить
                      </button>
                      <button
                        className="btn-ghost text-xs px-2.5 py-1"
                        disabled={loading}
                        onClick={() => onToggle(tpl, !tpl.is_active)}
                        type="button"
                      >
                        {tpl.is_active ? "Отключить" : "Включить"}
                      </button>
                    </div>
                  </div>
                  {diffs[tpl.template_id] && (
                    <div className="mt-2 banner-sky p-2.5 text-xs">
                      <p>Изменено: {diffs[tpl.template_id]?.changed_columns.join(", ") || "нет"}</p>
                      <p>+ заголовки: {diffs[tpl.template_id]?.added_header_tokens.join(", ") || "нет"}</p>
                      <p>− заголовки: {diffs[tpl.template_id]?.removed_header_tokens.join(", ") || "нет"}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
