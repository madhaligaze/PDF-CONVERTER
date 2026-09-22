"use client";

import { useEffect, useState } from "react";

import { useScrollLock } from "@/components/use-scroll-lock";
import { useWorkbench } from "@/components/workbench/context";
import type {
  AnalyzeDiffResponse,
  ClarifyQuestion,
  DiffFinding,
  SmartRefineResponse,
} from "@/components/workbench/types";

type Props = {
  originalVariantKey: string;
  editedColumns: Array<Record<string, unknown>>;
  editedRows: Array<Record<string, unknown>>;
  onConfirm: (formulas: Record<string, string>) => void;
  onClose: () => void;
};

const FINDING_ICON: Record<string, string> = {
  formula_detected: "✓",
  filter_detected: "⊘",
  cell_changed: "✎",
  label_change: "✎",
  column_added: "+",
  column_removed: "−",
  row_removed: "⊘",
};

const CONFIDENCE_COLOR = (c: number) =>
  // Уверенная сверка цветом не помечается: цвет — только на сомнении и отказе.
  c >= 0.85 ? "var(--text-secondary)" :
  c >= 0.65 ? "var(--amber-500, #f59e0b)" :
  "var(--text-secondary)";

// Merge SmartRefineResponse back into AnalyzeDiffResponse shape for display
function mergeSmartResult(
  base: AnalyzeDiffResponse | null,
  smart: SmartRefineResponse,
): AnalyzeDiffResponse {
  return {
    findings: smart.findings,
    summary_ru: smart.narrative_ru || smart.summary_ru || base?.summary_ru || "",
  };
}

export function DiffAnalysisPanel({
  originalVariantKey,
  editedColumns,
  editedRows,
  onConfirm,
  onClose,
}: Props) {
  const { handleAnalyzeDiff, handleSmartRefine, handleClarify } = useWorkbench();

  useScrollLock(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [result, setResult] = useState<AnalyzeDiffResponse | null>(null);
  const [narrative, setNarrative] = useState<string>("");
  const [clarifications, setClarifications] = useState<ClarifyQuestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Per-finding hint state: maps finding index → hint text
  const [hintTarget, setHintTarget] = useState<number | null>(null);
  const [hint, setHint] = useState("");
  const [isReAnalyzing, setIsReAnalyzing] = useState(false);

  const runAnalysis = async () => {
    setIsLoading(true);
    setResult(null);
    setNarrative("");
    setClarifications([]);
    const res = await handleAnalyzeDiff(originalVariantKey, editedColumns, editedRows);
    setResult(res);
    setNarrative(res?.summary_ru ?? "");
    setIsLoading(false);
  };

  const runSmartRefine = async () => {
    if (!hint.trim()) return;
    setIsReAnalyzing(true);

    const targetFinding = hintTarget !== null ? result?.findings[hintTarget] : null;
    const targetColumnKey = targetFinding?.column_key ?? null;

    const res = await handleSmartRefine(
      originalVariantKey,
      editedColumns,
      editedRows,
      hint,
      targetColumnKey,
      result?.findings ?? null,
    );

    if (res) {
      setResult(mergeSmartResult(result, res));
      setNarrative(res.narrative_ru || res.summary_ru);
      setClarifications(res.clarifications ?? []);
    }
    setHintTarget(null);
    setHint("");
    setIsReAnalyzing(false);
  };

  const runClarify = async (clarifyQ: ClarifyQuestion, choiceIndex: number) => {
    setIsReAnalyzing(true);
    const res = await handleClarify(
      originalVariantKey,
      editedColumns,
      editedRows,
      hint || clarifyQ.choice_formulas[choiceIndex] || "",
      clarifyQ.question_ru,
      choiceIndex,
      clarifyQ.column_key ?? null,
      result?.findings ?? null,
    );
    if (res) {
      setResult(mergeSmartResult(result, res));
      setNarrative(res.narrative_ru || res.summary_ru);
      setClarifications([]);
    }
    setIsReAnalyzing(false);
  };

  const handleConfirm = () => {
    if (!result) return;
    const formulas: Record<string, string> = {};
    for (const f of result.findings) {
      if (f.type === "formula_detected" && f.column_key && f.detected_formula) {
        formulas[f.column_key] = f.detected_formula;
      }
    }
    onConfirm(formulas);
  };

  const hasFormulas = result?.findings.some(
    (f) => f.type === "formula_detected" && f.detected_formula
  );

  return (
    <div
      // Панель прижата к низу, поэтому нижний отступ считается от домашней
      // полоски — иначе её край уезжает под неё.
      className="fixed inset-0 z-50 flex items-end justify-center p-4"
      style={{
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        paddingBottom: "max(1rem, var(--safe-b))",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-base)",
          maxHeight: "80svh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border-base)" }}
        >
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              Понять расчёт
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              Анализирую что вы изменили и пытаюсь определить логику
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-lg leading-none opacity-50 hover:opacity-100"
            style={{ color: "var(--text-primary)" }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {!result && !isLoading && (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Нажмите «Анализировать» — движок изучит ваши правки
                и попытается понять математику за ними.
              </p>
              <button
                className="btn-primary px-6 py-2 text-sm"
                onClick={() => void runAnalysis()}
              >
                Анализировать изменения
              </button>
            </div>
          )}

          {isLoading && (
            <div className="text-center py-8">
              <div className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin opacity-60" />
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
                Анализирую…
              </p>
            </div>
          )}

          {result && (
            <>
              {/* Narrative strip */}
              {narrative && (
                <div
                  className="rounded-lg px-4 py-3 text-sm"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-primary)",
                    borderLeft: "3px solid var(--blue-400, #60a5fa)",
                  }}
                >
                  {narrative}
                </div>
              )}

              {/* Clarify chips */}
              {clarifications.length > 0 && (
                <div className="space-y-2">
                  {clarifications.map((cq, qi) => (
                    <ClarifyChips
                      key={qi}
                      question={cq}
                      disabled={isReAnalyzing}
                      onChoose={(idx) => void runClarify(cq, idx)}
                    />
                  ))}
                </div>
              )}

              {/* Findings list */}
              {result.findings.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: "var(--text-secondary)" }}>
                  Существенных изменений не обнаружено
                </p>
              ) : (
                <div className="space-y-2">
                  {result.findings.map((finding, idx) => (
                    <FindingCard
                      key={idx}
                      finding={finding}
                      isHintOpen={hintTarget === idx}
                      hint={hint}
                      isReAnalyzing={isReAnalyzing}
                      onOpenHint={() => { setHintTarget(idx); setHint(""); }}
                      onCloseHint={() => setHintTarget(null)}
                      onHintChange={setHint}
                      onReAnalyze={() => void runSmartRefine()}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 px-5 py-3 border-t"
          style={{ borderColor: "var(--border-base)" }}
        >
          <button
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => void runAnalysis()}
            disabled={isLoading}
          >
            ↺ Повторить анализ
          </button>
          <div className="flex gap-2">
            <button className="btn-ghost px-4 py-1.5 text-sm" onClick={onClose}>
              Закрыть
            </button>
            {hasFormulas && (
              <button
                className="btn-primary px-4 py-1.5 text-sm"
                onClick={handleConfirm}
              >
                Подтвердить расчёт
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function ClarifyChips({
  question,
  disabled,
  onChoose,
}: {
  question: ClarifyQuestion;
  disabled: boolean;
  onChoose: (idx: number) => void;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 space-y-2"
      style={{
        background: "var(--bg-hover)",
        border: "1px solid var(--amber-500, #f59e0b)",
      }}
    >
      <p className="text-xs font-medium" style={{ color: "var(--amber-500, #f59e0b)" }}>
        ⚠ {question.question_ru}
      </p>
      <div className="flex flex-wrap gap-2">
        {question.choices.map((choice, idx) => (
          <button
            key={idx}
            disabled={disabled}
            onClick={() => onChoose(idx)}
            className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-base)",
              color: "var(--blue-400, #60a5fa)",
            }}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}


function FindingCard({
  finding,
  isHintOpen,
  hint,
  isReAnalyzing,
  onOpenHint,
  onCloseHint,
  onHintChange,
  onReAnalyze,
}: {
  finding: DiffFinding;
  isHintOpen: boolean;
  hint: string;
  isReAnalyzing: boolean;
  onOpenHint: () => void;
  onCloseHint: () => void;
  onHintChange: (v: string) => void;
  onReAnalyze: () => void;
}) {
  const icon = FINDING_ICON[finding.type] ?? "•";
  const confColor = CONFIDENCE_COLOR(finding.confidence);
  const confPct = Math.round(finding.confidence * 100);
  const needsClarify = finding.needs_clarification === true;

  return (
    <div
      className="rounded-xl px-4 py-3 space-y-2"
      style={{
        background: "var(--bg-hover)",
        border: `1px solid ${needsClarify ? "var(--amber-500, #f59e0b)" : "var(--border-base)"}`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="text-sm font-bold mt-0.5 w-5 text-center shrink-0"
          style={{ color: confColor }}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm leading-snug" style={{ color: "var(--text-primary)" }}>
            {finding.explanation_ru}
          </p>
          {finding.detected_formula && (
            <code
              className="mt-1 inline-block text-xs px-2 py-0.5 rounded"
              style={{
                background: "var(--surface)",
                color: "var(--blue-400, #60a5fa)",
                border: "1px solid var(--border-base)",
              }}
            >
              = {finding.detected_formula}
            </code>
          )}
          {finding.intent && (
            <span
              className="mt-1 ml-2 inline-block text-xs px-1.5 py-0.5 rounded opacity-60"
              style={{ background: "var(--surface)", color: "var(--text-secondary)" }}
            >
              {finding.intent}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs" style={{ color: confColor }}>
            {confPct}%
          </span>
          {finding.type !== "label_change" && finding.type !== "column_removed" && (
            <button
              className="text-xs underline opacity-60 hover:opacity-100"
              style={{ color: "var(--text-secondary)" }}
              onClick={isHintOpen ? onCloseHint : onOpenHint}
            >
              {isHintOpen ? "Скрыть" : "Уточнить"}
            </button>
          )}
        </div>
      </div>

      {isHintOpen && (
        <div className="space-y-2 pt-1 border-t" style={{ borderColor: "var(--border-base)" }}>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Объясните логику этого расчёта (русский текст, можно с опечатками):
          </p>
          <textarea
            rows={2}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-base)",
              color: "var(--text-primary)",
              outline: "none",
            }}
            placeholder='Например: "Делил на курс доллара 485, чтобы перевести в USD"'
            value={hint}
            onChange={(e) => onHintChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onReAnalyze();
            }}
          />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost px-3 py-1 text-xs" onClick={onCloseHint}>
              Отмена
            </button>
            <button
              className="btn-primary px-3 py-1 text-xs"
              onClick={onReAnalyze}
              disabled={isReAnalyzing || !hint.trim()}
            >
              {isReAnalyzing ? "Анализирую…" : "Перепроверить"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
