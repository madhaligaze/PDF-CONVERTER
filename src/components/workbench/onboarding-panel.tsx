"use client";

import { useState } from "react";
import type { OnboardingProject } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

const STATUS_BADGE: Record<string, string> = {
  draft:              "badge-slate",
  collecting_samples: "badge-blue",
  mapping:            "badge-amber",
  validated:          "badge-slate",
};

const STATUS_LABEL: Record<string, string> = {
  draft:              "черновик",
  collecting_samples: "сбор образцов",
  mapping:            "сопоставление",
  validated:          "проверен",
};

type Props = {
  projects: OnboardingProject[];
  onCreateProject: (name: string, bankName: string, notes: string) => void;
  onAttachCurrentResult: (projectId: string) => void;
};

export function OnboardingPanel({ projects, onCreateProject, onAttachCurrentResult }: Props) {
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <SectionCard title="Подключение банка" subtitle="Сбор образцов для нового банка">
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-2 card-inner p-4">
          <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>Новый проект</p>
          <input
            className="input-field"
            placeholder="Название проекта"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input-field"
            placeholder="Название банка"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
          <textarea
            className="input-field min-h-20 resize-none"
            placeholder="Примечания (необязательно)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="btn-primary w-full"
            disabled={!name.trim() || !bankName.trim()}
            onClick={() => {
              onCreateProject(name, bankName, notes);
              setName("");
              setBankName("");
              setNotes("");
            }}
            type="button"
          >
            Создать проект
          </button>
        </div>

        <div className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--text-muted)" }}>
              Проектов ещё нет.
            </p>
          ) : null}
          {projects.map((project) => (
            <div
              key={project.project_id}
              className="row-item px-4 py-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {project.name}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`badge text-[0.62rem] ${STATUS_BADGE[project.status] ?? "badge-slate"}`}>
                    {STATUS_LABEL[project.status] ?? project.status}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {project.bank_name}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {project.samples.length} образцов
                  </span>
                </div>
              </div>
              <button
                className="btn-ghost text-xs px-3 py-1.5 flex-shrink-0"
                onClick={() => onAttachCurrentResult(project.project_id)}
                type="button"
              >
                Прикрепить
              </button>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
