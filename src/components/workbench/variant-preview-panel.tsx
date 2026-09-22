"use client";

import { useMemo, useRef, useState } from "react";

import { useWorkbench } from "@/components/workbench/context";
import { DiffAnalysisPanel } from "@/components/workbench/diff-analysis-panel";
import { SaveTemplateModal } from "@/components/workbench/save-template-modal";
import type { ColumnRecommendation, PreviewColumn, PreviewResponse, PreviewVariant, RowDiagnostic } from "@/components/workbench/types";
import { formatValue } from "@/components/workbench/utils";

const PAGE_SIZE = 50;
const PRIMARY_GROUP = "primary";

type EditableRow = Record<string, string | number | null>;

type Props = {
  variants: PreviewVariant[];
  diagnostics: RowDiagnostic[];
};

function confidenceColor(c: number) {
  // Уверенная строка цветом не помечается — цвет только у сомнения и отказа.
  if (c >= 0.9) return "badge-slate";
  if (c >= 0.7) return "badge-amber";
  return "badge-rose";
}

function variantGroupKey(v: PreviewVariant) {
  return v.group ?? PRIMARY_GROUP;
}

function isWideTextColumn(key: string, kind: string) {
  if (kind === "currency") return false;
  return ["detail", "comment", "details_operation"].includes(key);
}

function ReadingContext({ document }: { document: PreviewResponse["document"] }) {
  const period = [document.period_start, document.period_end].filter(Boolean).join(" — ");
  const bits = [document.account_holder, document.account_number, document.currency, period].filter(Boolean);
  if (bits.length === 0) return null;
  return (
    <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
      {bits.join(" · ")}
    </p>
  );
}

function emptyRow(columns: PreviewColumn[]): EditableRow {
  const r: EditableRow = {};
  for (const c of columns) r[c.key] = "";
  return r;
}

export function VariantPreviewPanel({ variants, diagnostics }: Props) {
  const {
    selectedVariantKey,
    setSelectedVariantKey,
    handleExport,
    isExporting,
    setExcludedExportRows,
    setCustomExportColumns,
    setCustomExportRows,
    deferredPreview,
    handleAdvisorColumn,
    handleValidateFormula,
    handleCompute,
  } = useWorkbench();

  const [page, setPage] = useState(0);

  // ── edit mode ──────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editColumns, setEditColumnsState] = useState<PreviewColumn[]>([]);
  // rows: copy of original rows merged with per-cell overrides + added rows
  const [editRows, setEditRowsState] = useState<EditableRow[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showDiffPanel, setShowDiffPanel] = useState(false);

  // formula per column: key → formula string
  const [columnFormulas, setColumnFormulas] = useState<Record<string, string>>({});
  const [formulaDrafts, setFormulaDrafts] = useState<Record<string, string>>({});
  const [formulaErrors, setFormulaErrors] = useState<Record<string, string | null>>({});

  // advisor state
  const [advisorColIdx, setAdvisorColIdx] = useState<number | null>(null);
  const [advisorResults, setAdvisorResults] = useState<ColumnRecommendation[]>([]);
  const [isAdvisorLoading, setIsAdvisorLoading] = useState(false);

  // cell editing
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colKey: string } | null>(null);
  const [cellDraft, setCellDraft] = useState("");
  const cellInputRef = useRef<HTMLInputElement>(null);

  // column rename
  const [editingColIdx, setEditingColIdx] = useState<number | null>(null);
  const [colLabelDraft, setColLabelDraft] = useState("");
  const colLabelRef = useRef<HTMLInputElement>(null);

  // ── variant navigation ─────────────────────────────────────
  const groupedVariants = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, PreviewVariant[]>();
    for (const v of variants) {
      const g = variantGroupKey(v);
      if (!groups.has(g)) { groups.set(g, []); order.push(g); }
      groups.get(g)!.push(v);
    }
    return { groups, order };
  }, [variants]);

  const selectedVariant =
    variants.find((v) => v.key === selectedVariantKey) ?? variants[0] ?? null;

  if (!selectedVariant) return null;

  const activeGroup = variantGroupKey(selectedVariant);
  const pageVariants = groupedVariants.groups.get(activeGroup) ?? [selectedVariant];
  const alternateGroup =
    activeGroup === PRIMARY_GROUP
      ? groupedVariants.order.find((g) => g !== PRIMARY_GROUP) ?? null
      : PRIMARY_GROUP;
  const showVariantSwitcher = groupedVariants.order.length > 1 && alternateGroup !== null;

  const selectVariant = (key: string) => {
    setSelectedVariantKey(key);
    setPage(0);
    exitEditMode(false);
  };

  const swapVariantGroup = () => {
    if (!alternateGroup) return;
    const tv = groupedVariants.groups.get(alternateGroup);
    const nv = tv?.find((v) => !v.template_id) ?? tv?.[0];
    if (!nv) return;
    setSelectedVariantKey(nv.key);
    setPage(0);
    exitEditMode(false);
  };

  // ── edit mode helpers ──────────────────────────────────────

  const enterEditMode = () => {
    setEditColumnsState(selectedVariant.columns.map((c) => ({ ...c })));
    setEditRowsState(selectedVariant.rows.map((r) => ({ ...r }) as EditableRow));
    setIsDirty(false);
    setColumnFormulas({});
    setFormulaDrafts({});
    setFormulaErrors({});
    setAdvisorColIdx(null);
    setAdvisorResults([]);
    setEditMode(true);
  };

  const exitEditMode = (withConfirm = true) => {
    if (withConfirm && isDirty &&
      !window.confirm("Выйти из режима редактирования? Несохранённые изменения будут потеряны.")) return;
    setEditMode(false);
    setIsDirty(false);
    setEditingCell(null);
    setEditingColIdx(null);
    setColumnFormulas({});
    setFormulaDrafts({});
    setFormulaErrors({});
    setAdvisorColIdx(null);
    setAdvisorResults([]);
    setCustomExportColumns(null);
    setCustomExportRows(null);
    setExcludedExportRows([]);
  };

  const markDirty = () => setIsDirty(true);

  // ── column ops ─────────────────────────────────────────────
  const setEditColumns = (cols: PreviewColumn[]) => { setEditColumnsState(cols); markDirty(); };

  const startColRename = (idx: number, label: string) => {
    setEditingColIdx(idx);
    setColLabelDraft(label);
    setTimeout(() => colLabelRef.current?.select(), 0);
  };

  const commitColRename = () => {
    if (editingColIdx !== null && colLabelDraft.trim()) {
      const next = editColumns.map((c, i) => i === editingColIdx ? { ...c, label: colLabelDraft.trim() } : c);
      setEditColumns(next);
    }
    setEditingColIdx(null);
  };

  const moveColumn = (idx: number, dir: -1 | 1) => {
    const next = [...editColumns];
    const t = idx + dir;
    if (t < 0 || t >= next.length) return;
    [next[idx], next[t]] = [next[t], next[idx]];
    setEditColumns(next);
  };

  const deleteColumn = (idx: number) => {
    setEditColumns(editColumns.filter((_, i) => i !== idx));
  };

  const addColumn = () => {
    setEditColumns([...editColumns, { key: `custom_${Date.now()}`, label: "Новый столбец", kind: "text" }]);
  };

  // ── formula helpers ────────────────────────────────────────
  const openAdvisor = async (colIdx: number) => {
    const col = editColumns[colIdx];
    if (!col) return;
    setAdvisorColIdx(colIdx);
    setAdvisorResults([]);
    setIsAdvisorLoading(true);
    // collect sample numeric values from this column
    const sampleVals = editRows
      .slice(0, 50)
      .map((r) => { const v = r[col.key]; return typeof v === "number" ? v : parseFloat(String(v ?? "")); })
      .filter((v) => !isNaN(v));
    const res = await handleAdvisorColumn(
      col.label,
      deferredPreview?.document.parser_key ?? "",
      sampleVals,
    );
    setAdvisorResults(res?.recommendations ?? []);
    setIsAdvisorLoading(false);
  };

  // Live recompute: ask the backend to evaluate formula columns over the current
  // edited rows and reflect the computed values in the table immediately.
  const recomputeLive = async (formulas: Record<string, string>) => {
    if (!selectedVariant) return;
    const customCols = editColumns.map((c) => ({
      key: c.key, label: c.label, kind: c.kind, formula: formulas[c.key] ?? null,
    }));
    const result = await handleCompute(
      selectedVariant.key,
      customCols,
      editRows as Array<Record<string, unknown>>,
    );
    if (result?.rows) setEditRowsState(result.rows as EditableRow[]);
  };

  const applyFormulaToColumn = (colKey: string, formula: string) => {
    setColumnFormulas((prev) => {
      const next = { ...prev, [colKey]: formula };
      void recomputeLive(next);
      return next;
    });
    setFormulaDrafts((prev) => ({ ...prev, [colKey]: formula }));
    markDirty();
  };

  const commitFormulaEdit = async (colKey: string) => {
    const formula = (formulaDrafts[colKey] ?? "").trim();
    if (!formula) {
      setColumnFormulas((prev) => { const n = { ...prev }; delete n[colKey]; return n; });
      setFormulaErrors((prev) => { const n = { ...prev }; delete n[colKey]; return n; });
      return;
    }
    const { valid, error } = await handleValidateFormula(formula);
    if (!valid) {
      setFormulaErrors((prev) => ({ ...prev, [colKey]: error ?? "Синтаксическая ошибка" }));
      return;
    }
    setFormulaErrors((prev) => { const n = { ...prev }; delete n[colKey]; return n; });
    applyFormulaToColumn(colKey, formula);
  };

  // ── row ops ────────────────────────────────────────────────
  const deleteRow = (idx: number) => {
    setEditRowsState((prev) => { const n = [...prev]; n.splice(idx, 1); return n; });
    markDirty();
  };

  const addRow = () => {
    setEditRowsState((prev) => [...prev, emptyRow(editColumns)]);
    markDirty();
  };

  // ── cell editing ───────────────────────────────────────────
  const startCellEdit = (rowIdx: number, colKey: string, currentVal: unknown) => {
    setEditingCell({ rowIdx, colKey });
    setCellDraft(currentVal != null && currentVal !== "" ? String(currentVal) : "");
    setTimeout(() => { cellInputRef.current?.focus(); cellInputRef.current?.select(); }, 0);
  };

  const commitCellEdit = () => {
    if (!editingCell) return;
    const { rowIdx, colKey } = editingCell;

    // Excel-style: if user typed "=..." → apply as formula to whole column
    if (cellDraft.startsWith("=")) {
      const formula = cellDraft.slice(1).trim();
      if (formula) {
        void commitFormulaEdit(colKey).then(() => {});
        setFormulaDrafts((p) => ({ ...p, [colKey]: formula }));
        applyFormulaToColumn(colKey, formula);
        setEditingCell(null);
        return;
      }
    }

    setEditRowsState((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [colKey]: cellDraft };
      return next;
    });
    markDirty();
    setEditingCell(null);
  };

  // ── reset ──────────────────────────────────────────────────
  const resetToDefault = () => {
    if (!window.confirm("Сбросить все изменения и вернуться к стандартному формату? Сохранённый шаблон для этого банка также будет удалён.")) return;
    const pk = deferredPreview?.document.parser_key;
    if (pk) { try { localStorage.removeItem(`template_id_${pk}`); } catch { /* ignore */ } }
    setEditColumnsState(selectedVariant.columns.map((c) => ({ ...c })));
    setEditRowsState(selectedVariant.rows.map((r) => ({ ...r }) as EditableRow));
    setIsDirty(false);
    setCustomExportColumns(null);
    setCustomExportRows(null);
    setExcludedExportRows([]);
  };

  // ── export ─────────────────────────────────────────────────
  const handleExportWithEdits = () => {
    if (editMode && isDirty) {
      setCustomExportColumns(editColumns.map((c) => ({
        key: c.key,
        label: c.label,
        kind: c.kind,
        formula: columnFormulas[c.key] ?? null,
      })));
      setCustomExportRows(editRows as Array<Record<string, unknown>>);
    }
    void handleExport();
  };

  // ── render data ────────────────────────────────────────────
  const displayColumns = editMode ? editColumns : selectedVariant.columns;
  const diagnosticsMap = new Map(diagnostics.map((d) => [d.row_number, d]));
  const displayRows: EditableRow[] = editMode ? editRows : (selectedVariant.rows as EditableRow[]);
  const totalPages = Math.ceil(displayRows.length / PAGE_SIZE);
  const pageRows = displayRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageOffset = page * PAGE_SIZE;

  return (
    <section className="card p-4 sm:p-5 animate-fade-in">

      {/* ── header ── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Предпросмотр
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            {selectedVariant.description}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!editMode && (
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={enterEditMode} type="button">
              Редактировать
            </button>
          )}
          {editMode && (
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => exitEditMode(true)} type="button">
              Выйти
            </button>
          )}
          <button className="btn-primary" disabled={isExporting} onClick={handleExportWithEdits} type="button">
            {isExporting ? "Экспорт..." : "Excel"}
          </button>
        </div>
      </div>

      {deferredPreview?.document.reading_note && (
        <div
          className="mb-4 rounded-lg px-3 py-2.5"
          style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)" }}
        >
          <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Как посчитано
          </p>
          <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {deferredPreview.document.reading_note}
          </p>
          <ReadingContext document={deferredPreview.document} />
        </div>
      )}

      {/* ── variant switcher ── */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start">
        {showVariantSwitcher && (
          <button
            className={`variant-group-toggle ${activeGroup === PRIMARY_GROUP ? "variant-group-toggle-pulse" : "variant-group-toggle-return"}`}
            onClick={swapVariantGroup} type="button"
          >
            <span className="variant-group-toggle__pulse" aria-hidden="true" />
            <span className="variant-group-toggle__label">
              {activeGroup === PRIMARY_GROUP ? "Доступны другие варианты" : "Вернуться к стандартным видам"}
            </span>
          </button>
        )}
        <div key={`vg-${activeGroup}`} className="flex flex-wrap gap-2 animate-variant-swap">
          {pageVariants.map((v) => (
            <button
              key={v.key}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-all"
              style={{
                background: v.key === selectedVariant.key ? "var(--text-primary)" : "transparent",
                color: v.key === selectedVariant.key ? "var(--bg-base)" : "var(--text-secondary)",
                border: v.key === selectedVariant.key ? "none" : "1px solid var(--border-base)",
              }}
              onClick={() => selectVariant(v.key)} type="button"
            >
              {v.name}
              <span className="ml-1.5" style={{ opacity: 0.5 }}>{v.rows.length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── edit mode hint ── */}
      {editMode && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs"
          style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)", color: "var(--text-secondary)" }}>
          <span>
            <b>Заголовок</b> — клик для переименования, кнопка <b>ƒ</b> для формулы &nbsp;·&nbsp;
            <b>Ячейка</b> — двойной клик (начните с <b>=</b> для формулы по всей колонке) &nbsp;·&nbsp;
            <b>←→</b> перемещение &nbsp;·&nbsp;
            <b>✕</b> удаление
          </span>
        </div>
      )}

      {/* ── table ── */}
      <div
        key={`vt-${activeGroup}-${selectedVariant.key}`}
        className="overflow-hidden rounded-[var(--radius-inner)] animate-variant-swap"
        style={{ border: "1px solid var(--border-base)" }}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">

            {/* thead */}
            <thead style={{ background: "var(--bg-hover)" }}>
              <tr>
                <th className="w-8 px-3 py-2.5 text-left text-xs font-medium" style={{ color: "var(--text-muted)" }}>#</th>
                {displayColumns.map((col, ci) => (
                  <th
                    key={col.key}
                    className={`px-2 py-2 text-left text-xs font-medium ${isWideTextColumn(col.key, col.kind) ? "min-w-[15rem] whitespace-normal" : "whitespace-nowrap"}`}
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {editMode ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1">
                          {editingColIdx === ci ? (
                            <input
                              ref={colLabelRef}
                              aria-label="Название столбца"
                              className="rounded px-1 py-0.5 text-xs w-28"
                              style={{ background: "var(--surface)", border: "1px solid var(--accent-blue,#3b82f6)", color: "var(--text-primary)", outline: "none" }}
                              value={colLabelDraft}
                              onChange={(e) => setColLabelDraft(e.target.value)}
                              onBlur={commitColRename}
                              onKeyDown={(e) => { if (e.key === "Enter") commitColRename(); if (e.key === "Escape") setEditingColIdx(null); }}
                            />
                          ) : (
                            <button
                              className="text-left hover:underline cursor-pointer"
                              style={{ color: "var(--text-primary)" }}
                              onClick={() => startColRename(ci, col.label)}
                              title="Нажмите для переименования" type="button"
                            >{col.label}</button>
                          )}
                          <span className="flex items-center gap-0.5 ml-1 opacity-50 hover:opacity-100">
                            <button type="button" title="Влево" disabled={ci === 0}
                              className="text-[10px] px-0.5 hover:text-[var(--text-primary)] disabled:opacity-20"
                              onClick={() => moveColumn(ci, -1)}>←</button>
                            <button type="button" title="Вправо" disabled={ci === displayColumns.length - 1}
                              className="text-[10px] px-0.5 hover:text-[var(--text-primary)] disabled:opacity-20"
                              onClick={() => moveColumn(ci, 1)}>→</button>
                            <button type="button" title="Добавить формулу"
                              className="text-[10px] px-0.5 hover:text-[var(--text-primary)]"
                              style={columnFormulas[col.key] ? { color: "var(--text-primary)", fontWeight: 700 } : undefined}
                              onClick={() => setAdvisorColIdx(advisorColIdx === ci ? null : ci)}>ƒ</button>
                            <button type="button" title="Удалить столбец"
                              className="text-[10px] px-0.5 hover:text-[var(--accent-rose)]"
                              onClick={() => deleteColumn(ci)}>✕</button>
                          </span>
                        </div>

                        {/* ── formula editor for this column ── */}
                        {advisorColIdx === ci && (
                          <div className="rounded-lg p-2 space-y-1.5 min-w-[16rem]"
                            style={{ background: "var(--surface)", border: "1px solid var(--border-base)" }}>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] font-mono opacity-50">=</span>
                              <input
                                className="flex-1 text-xs rounded px-1.5 py-0.5 font-mono"
                                style={{
                                  background: "var(--bg-hover)",
                                  border: formulaErrors[col.key] ? "1px solid #f43f5e" : "1px solid var(--border-base)",
                                  color: "var(--text-primary)", outline: "none",
                                }}
                                placeholder="{amount} * 0.12"
                                value={formulaDrafts[col.key] ?? columnFormulas[col.key] ?? ""}
                                onChange={(e) => setFormulaDrafts((p) => ({ ...p, [col.key]: e.target.value }))}
                                onBlur={() => void commitFormulaEdit(col.key)}
                                onKeyDown={(e) => { if (e.key === "Enter") void commitFormulaEdit(col.key); if (e.key === "Escape") setAdvisorColIdx(null); }}
                              />
                              <button type="button"
                                className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)", color: "var(--text-secondary)" }}
                                title="AI подобрать"
                                onClick={() => void openAdvisor(ci)}
                              >{isAdvisorLoading && advisorColIdx === ci ? "…" : "✦"}</button>
                            </div>
                            {formulaErrors[col.key] && (
                              <p className="text-[10px]" style={{ color: "#f43f5e" }}>{formulaErrors[col.key]}</p>
                            )}
                            {/* Advisor recommendations */}
                            {advisorResults.length > 0 && advisorColIdx === ci && (
                              <div className="space-y-1 pt-1 border-t" style={{ borderColor: "var(--border-base)" }}>
                                <p className="text-[10px] opacity-50">Предложения:</p>
                                {advisorResults.slice(0, 3).map((rec, ri) => (
                                  <button key={ri} type="button"
                                    className="w-full text-left rounded px-2 py-1 space-y-0.5 hover:opacity-80"
                                    style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)" }}
                                    onClick={() => {
                                      setFormulaDrafts((p) => ({ ...p, [col.key]: rec.formula }));
                                      applyFormulaToColumn(col.key, rec.formula);
                                      setAdvisorColIdx(null);
                                    }}
                                  >
                                    <code className="text-[10px] block" style={{ color: "var(--blue-400,#60a5fa)" }}>{rec.formula}</code>
                                    <span className="text-[10px] block opacity-70">{rec.explanation} ({Math.round(rec.confidence * 100)}%)</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : col.label}
                  </th>
                ))}
                {editMode && (
                  <th className="px-2 py-2 w-8">
                    <button type="button" title="Добавить столбец"
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "var(--bg-hover)", border: "1px dashed var(--border-base)", color: "var(--text-muted)" }}
                      onClick={addColumn}>+</button>
                  </th>
                )}
                {!editMode && (
                  <th className="w-12 px-3 py-2.5 text-left text-xs font-medium" style={{ color: "var(--text-muted)" }}>Увер.</th>
                )}
              </tr>
            </thead>

            {/* tbody */}
            <tbody>
              {pageRows.map((row, localIdx) => {
                const absIdx = pageOffset + localIdx;
                const rowNumber = absIdx + 1;
                const diagnostic = diagnosticsMap.get(rowNumber);
                const direction = row.direction as string | undefined;
                const rowClass = direction === "inflow" ? "row-inflow" : direction === "outflow" ? "row-outflow" : "";

                return (
                  <tr key={`${selectedVariant.key}-${absIdx}`}
                    className={`${rowClass} transition-colors`}
                    style={{ borderTop: "1px solid var(--border-subtle)" }}>

                    {/* row # */}
                    <td className="px-3 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>{rowNumber}</td>

                    {/* data cells */}
                    {displayColumns.map((col) => {
                      const rawVal = row[col.key];
                      const isEditing = editMode && editingCell?.rowIdx === absIdx && editingCell?.colKey === col.key;
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2 ${isWideTextColumn(col.key, col.kind) ? "min-w-[15rem] whitespace-normal break-words align-top" : "whitespace-nowrap"}`}
                          style={{ color: "var(--text-primary)" }}
                          onDoubleClick={() => editMode && startCellEdit(absIdx, col.key, rawVal)}
                          title={editMode ? "Двойной клик для редактирования" : undefined}
                        >
                          {isEditing ? (
                            <input
                              ref={cellInputRef}
                              aria-label={col.label}
                              className="w-full rounded px-1 py-0.5 text-xs"
                              style={{ background: "var(--surface)", border: "1px solid var(--accent-blue,#3b82f6)", color: "var(--text-primary)", outline: "none", minWidth: "6rem" }}
                              value={cellDraft}
                              onChange={(e) => setCellDraft(e.target.value)}
                              onBlur={commitCellEdit}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { commitCellEdit(); }
                                if (e.key === "Escape") setEditingCell(null);
                                if (e.key === "Tab") { e.preventDefault(); commitCellEdit(); }
                              }}
                            />
                          ) : (
                            <span style={editMode ? { cursor: "text", minWidth: "2rem", display: "inline-block" } : undefined}>
                              {formatValue(rawVal as string | number | null | undefined, col.kind)}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* edit actions */}
                    {editMode && (
                      <td className="px-2 py-2.5 text-center">
                        <button type="button" title="Удалить строку"
                          className="text-xs opacity-30 hover:opacity-100 hover:text-[var(--accent-rose)]"
                          onClick={() => deleteRow(absIdx)}>✕</button>
                      </td>
                    )}
                    {!editMode && (
                      <td className="px-3 py-2.5">
                        {diagnostic ? (
                          <span className={`badge text-[0.65rem] ${confidenceColor(diagnostic.confidence)}`}>
                            {Math.round(diagnostic.confidence * 100)}%
                          </span>
                        ) : (
                          <span className="badge badge-slate text-[0.65rem]">-</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* add row button */}
              {editMode && (
                <tr style={{ borderTop: "1px solid var(--border-subtle)" }}>
                  <td colSpan={displayColumns.length + 2} className="px-3 py-2">
                    <button type="button" onClick={addRow}
                      className="text-xs flex items-center gap-1.5 opacity-50 hover:opacity-100"
                      style={{ color: "var(--text-secondary)" }}>
                      <span className="text-base leading-none">+</span> Добавить строку
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── pagination ── */}
      {totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Строки {pageOffset + 1}–{Math.min((page + 1) * PAGE_SIZE, displayRows.length)} из {displayRows.length}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={page === 0}
              onClick={() => setPage((p) => p - 1)} type="button">&larr; Назад</button>
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)} type="button">Вперёд &rarr;</button>
          </div>
        </div>
      )}

      {/* ── dirty bar ── */}
      {editMode && isDirty && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3"
          style={{ background: "var(--bg-hover)", border: "1px solid var(--border-base)" }}>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Есть несохранённые изменения — <span style={{ color: "var(--text-muted)" }}>строк: {displayRows.length}, столбцов: {displayColumns.length}</span>
            {Object.keys(columnFormulas).length > 0 && (
              <span className="ml-2" style={{ color: "var(--text-primary)" }}>
                · формул: {Object.keys(columnFormulas).length}
              </span>
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={resetToDefault} type="button">
              Сбросить к стандарту
            </button>
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setShowDiffPanel(true)}
              type="button"
              title="Анализировать что изменилось и понять логику расчётов"
            >
              ✦ Понять расчёт
            </button>
            <button className="btn-primary px-3 py-1.5 text-xs"
              onClick={() => { setCustomExportColumns(editColumns); setCustomExportRows(editRows as Array<Record<string, unknown>>); setShowSaveModal(true); }}
              type="button">
              Сохранить шаблон
            </button>
          </div>
        </div>
      )}

      {/* ── save modal ── */}
      {showSaveModal && (
        <SaveTemplateModal
          parserKey={deferredPreview?.document.parser_key ?? "unknown"}
          variantKey={selectedVariant.key}
          columns={editColumns.map((c) => ({
            key: c.key,
            label: c.label,
            kind: c.kind,
            enabled: true,
            formula: columnFormulas[c.key] ?? null,
            ai_description: null,
          }))}
          onClose={() => setShowSaveModal(false)}
          onSaved={(templateId) => {
            setShowSaveModal(false);
            setIsDirty(false);
            setEditMode(false);
            setCustomExportColumns(editColumns.map((c) => ({
              key: c.key, label: c.label, kind: c.kind,
              formula: columnFormulas[c.key] ?? null,
            })));
            setCustomExportRows(editRows as Array<Record<string, unknown>>);
            setSelectedVariantKey(`template::${templateId}`);
          }}
        />
      )}

      {/* ── diff analysis panel ── */}
      {showDiffPanel && (
        <DiffAnalysisPanel
          originalVariantKey={selectedVariant.key}
          editedColumns={editColumns.map((c) => ({ key: c.key, label: c.label, kind: c.kind }))}
          editedRows={editRows as Array<Record<string, unknown>>}
          onConfirm={(formulas) => {
            setColumnFormulas((prev) => {
              const next = { ...prev, ...formulas };
              void recomputeLive(next);
              return next;
            });
            setFormulaDrafts((prev) => ({ ...prev, ...formulas }));
            markDirty();
            setShowDiffPanel(false);
          }}
          onClose={() => setShowDiffPanel(false)}
        />
      )}
    </section>
  );
}
