import type { CorrectionMemoryEntry } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

export function CorrectionMemoryPanel({ entries }: { entries: CorrectionMemoryEntry[] }) {
  return (
    <SectionCard
      title="Память исправлений"
      subtitle="Изученные исправления применяются к новым сессиям"
    >
      {entries.length === 0 ? (
        <p className="text-sm py-3 text-center" style={{ color: "var(--text-muted)" }}>
          Исправлений ещё нет.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.slice(0, 12).map((entry) => (
            <div key={entry.correction_id} className="row-item px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs mb-0.5" style={{ color: "var(--text-muted)" }}>
                    {entry.field_name}
                  </p>
                  <p className="text-sm truncate">
                    <span style={{ color: "var(--text-muted)", textDecoration: "line-through" }}>{entry.original_value}</span>
                    <span className="mx-1.5" style={{ color: "var(--text-muted)" }}>→</span>
                    <span style={{ color: "var(--text-primary)" }}>{entry.corrected_value}</span>
                  </p>
                </div>
                <span className="badge badge-slate flex-shrink-0">{entry.frequency}×</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
