import type { SessionSummary } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

type Props = {
  history: SessionSummary[];
  loading: boolean;
  onOpen: (sessionId: string) => void;
};

export function HistoryPanel({ history, loading, onOpen }: Props) {
  return (
    <SectionCard title="Последние сессии">
      {history.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
          Сессий ещё нет.
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <button
              key={item.session_id}
              className="row-item flex w-full items-center justify-between px-4 py-3.5 text-left disabled:opacity-50"
              style={{ minHeight: "56px" }}
              disabled={loading}
              onClick={() => onOpen(item.session_id)}
              type="button"
            >
              <span className="min-w-0">
                <span
                  className="block text-sm font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {item.title}
                </span>
                <span
                  className="mt-0.5 block text-xs truncate"
                  style={{ color: "var(--text-muted)" }}
                >
                  {item.source_filename} · {item.transaction_count} строк
                </span>
              </span>
              <span className="ml-3 flex-shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(item.created_at).toLocaleDateString("ru-RU")}
              </span>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
