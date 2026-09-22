import type { JobSummary } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

const STATUS_BADGE: Record<string, string> = {
  queued:    "badge-slate",
  running:   "badge-amber",
  completed: "badge-slate",
  failed:    "badge-rose",
};

const STATUS_LABEL: Record<string, string> = {
  queued:    "в очереди",
  running:   "выполняется",
  completed: "завершено",
  failed:    "ошибка",
};

type Props = {
  jobs: JobSummary[];
  onOpenSession: (sessionId: string) => void;
};

export function JobsPanel({ jobs, onOpenSession }: Props) {
  const visible = jobs.slice(0, 8);
  return (
    <SectionCard title="Фоновые задачи" subtitle="Очередь асинхронной обработки">
      {visible.length === 0 ? (
        <p className="text-sm py-3 text-center" style={{ color: "var(--text-muted)" }}>
          Задач ещё нет.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((job) => (
            <div
              key={job.job_id}
              className="row-item flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p
                  className="text-sm font-medium truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {job.source_filename || job.job_id}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`badge text-[0.62rem] ${STATUS_BADGE[job.status] ?? "badge-slate"}`}>
                    {STATUS_LABEL[job.status] ?? job.status}
                  </span>
                  <span className="text-[0.65rem]" style={{ color: "var(--text-muted)" }}>
                    {job.job_type}
                  </span>
                </div>
                {job.error_message ? (
                  <p className="mt-1 text-xs truncate" style={{ color: "var(--accent-rose)" }}>{job.error_message}</p>
                ) : null}
              </div>
              {job.session_id ? (
                <button
                  className="btn-ghost text-xs px-3 py-1.5 flex-shrink-0"
                  onClick={() => onOpenSession(job.session_id!)}
                  type="button"
                >
                  Открыть
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
