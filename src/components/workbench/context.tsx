"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type PropsWithChildren,
} from "react";

import type {
  OCRRuleVersionDiff,
  ParserDescriptor,
  PreviewVariant,
  PreviewResponse,
  SessionSummary,
} from "@/components/workbench/types";

export type Toast = {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
};

export type WorkbenchCtx = {
  preview: PreviewResponse | null;
  deferredPreview: PreviewResponse | null;
  allVariants: PreviewResponse["variants"];
  history: SessionSummary[];
  parsers: ParserDescriptor[];
  selectedVariantKey: string | null;
  setSelectedVariantKey: (k: string) => void;
  selectedReviewTableIndex: number;
  setSelectedReviewTableIndex: (i: number) => void;
  selectedReviewHeaderRow: number;
  setSelectedReviewHeaderRow: (i: number) => void;
  reviewTitle: string;
  setReviewTitle: (v: string) => void;
  saveReviewTemplate: boolean;
  setSaveReviewTemplate: (v: boolean) => void;
  reviewTemplateName: string;
  setReviewTemplateName: (v: string) => void;
  reviewColumnMapping: Record<string, string>;
  setReviewColumnMappingField: (field: string, value: string) => void;
  excludedExportRows: number[];
  setExcludedExportRows: (rows: number[]) => void;
  customExportColumns: Array<{key: string; label: string; kind: string; formula?: string | null}> | null;
  setCustomExportColumns: (cols: Array<{key: string; label: string; kind: string; formula?: string | null}> | null) => void;
  customExportRows: Array<Record<string, unknown>> | null;
  setCustomExportRows: (rows: Array<Record<string, unknown>> | null) => void;
  isPending: boolean;
  isMaterializingReview: boolean;
  isExporting: boolean;
  isExportingCsv: boolean;
  isLoadingSession: boolean;
  error: string | null;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  handlePreviewNow: (file: File) => void;
  handleExport: () => void;
  handleExportCsv: () => void;
  handleMaterializeReview: () => void;
  handleCompareRule: (_templateId: string) => Promise<OCRRuleVersionDiff | null>;
  handleCreateTemplate: (name: string, parserKey: string, variantKey: string, columns: Array<{key: string; label: string; kind: string; formula?: string | null; ai_description?: string | null}>) => Promise<string | null>;
  handleAdvisorColumn: (columnName: string, parserKey: string, sampleValues?: number[], contextColumns?: Record<string, number[]>) => Promise<import("@/components/workbench/types").AdvisorColumnResponse | null>;
  handleAnalyzeDiff: (originalVariantKey: string, editedColumns: Array<Record<string, unknown>>, editedRows: Array<Record<string, unknown>>) => Promise<import("@/components/workbench/types").AnalyzeDiffResponse | null>;
  handleReAnalyze: (originalVariantKey: string, editedColumns: Array<Record<string, unknown>>, editedRows: Array<Record<string, unknown>>, userHint: string, targetColumnKey?: string | null) => Promise<import("@/components/workbench/types").AnalyzeDiffResponse | null>;
  handleSmartRefine: (originalVariantKey: string, editedColumns: Array<Record<string, unknown>>, editedRows: Array<Record<string, unknown>>, userHint: string, targetColumnKey?: string | null, existingFindings?: import("@/components/workbench/types").DiffFinding[] | null) => Promise<import("@/components/workbench/types").SmartRefineResponse | null>;
  handleClarify: (originalVariantKey: string, editedColumns: Array<Record<string, unknown>>, editedRows: Array<Record<string, unknown>>, userHint: string, questionRu: string, choiceIndex: number, targetColumnKey?: string | null, existingFindings?: import("@/components/workbench/types").DiffFinding[] | null) => Promise<import("@/components/workbench/types").SmartRefineResponse | null>;
  handleValidateFormula: (formula: string) => Promise<{valid: boolean; error: string | null}>;
  handleCompute: (variantKey: string, customColumns: Array<Record<string, unknown>>, customRows: Array<Record<string, unknown>>, excludedRows?: number[]) => Promise<{ columns: Array<{ key: string; label: string; kind: string }>; rows: Array<Record<string, unknown>> } | null>;
  handleUploadScan: (file: File) => Promise<import("@/components/workbench/types").ScanResponse | null>;
  handleDownloadScanDocx: (scanId: string) => void;
  handleScanToReview: (scanId: string) => Promise<string | null>;
  loadSession: (sessionId: string) => void;
};

const Ctx = createContext<WorkbenchCtx | null>(null);

export function useWorkbench(): WorkbenchCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkbench must be used inside WorkbenchProvider");
  return ctx;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { detail?: string; message?: string; error?: string };
      return payload.detail ?? payload.message ?? payload.error ?? `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }

  try {
    const text = await response.text();
    return text || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return (await response.json()) as T;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function mergePreviewVariants(preview: PreviewResponse | null): PreviewVariant[] {
  if (!preview) return [];

  const savedVariants = preview.saved_variants ?? [];
  const baseVariants = preview.variants ?? [];
  const replacedBaseKeys = new Set(
    savedVariants
      .map((variant) => variant.base_variant_key)
      .filter((key): key is string => Boolean(key)),
  );
  const seen = new Set<string>();
  const merged: PreviewVariant[] = [];

  for (const variant of savedVariants) {
    if (seen.has(variant.key)) continue;
    merged.push(variant);
    seen.add(variant.key);
  }

  for (const variant of baseVariants) {
    if (replacedBaseKeys.has(variant.key) || seen.has(variant.key)) continue;
    merged.push(variant);
    seen.add(variant.key);
  }

  return merged;
}

type WorkbenchProviderProps = PropsWithChildren<{
  apiBaseUrl: string;
}>;

export function WorkbenchProvider({ children, apiBaseUrl }: WorkbenchProviderProps) {
  const api = apiBaseUrl.replace(/\/$/, "");

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [history, setHistory] = useState<SessionSummary[]>([]);
  const [parsers, setParsers] = useState<ParserDescriptor[]>([]);
  const [selectedVariantKey, setSelectedVariantKey] = useState<string | null>(null);
  const [selectedReviewTableIndex, setSelectedReviewTableIndex] = useState(0);
  const [selectedReviewHeaderRow, setSelectedReviewHeaderRow] = useState(0);
  const [reviewTitle, setReviewTitle] = useState("");
  const [saveReviewTemplate, setSaveReviewTemplate] = useState(true);
  const [reviewTemplateName, setReviewTemplateName] = useState("");
  const [reviewColumnMapping, setReviewColumnMapping] = useState<Record<string, string>>({});
  const [isPending, startUpload] = useTransition();
  const [isMaterializingReview, setIsMaterializingReview] = useState(false);
  const [excludedExportRows, setExcludedExportRows] = useState<number[]>([]);
  const [customExportColumns, setCustomExportColumns] = useState<Array<{key: string; label: string; kind: string}> | null>(null);
  const [customExportRows, setCustomExportRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const deferredPreview = useDeferredValue(preview);
  const allVariants = useMemo(
    () => mergePreviewVariants(deferredPreview),
    [deferredPreview],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const payload = await fetchJson<unknown>(`${api}/api/v1/transforms/history`);
      setHistory(ensureArray<SessionSummary>(payload));
    } catch {
      setHistory([]);
    }
  }, [api]);

  const loadParsers = useCallback(async () => {
    try {
      const payload = await fetchJson<unknown>(`${api}/api/v1/transforms/parsers`);
      setParsers(ensureArray<ParserDescriptor>(payload));
    } catch {
      setParsers([]);
    }
  }, [api]);

  useEffect(() => {
    startTransition(() => {
      void Promise.all([loadHistory(), loadParsers()]);
    });
  }, [loadHistory, loadParsers]);

  // Auto-recover from "offline": while no parsers are loaded (backend unreachable),
  // keep retrying every 20s and also when the browser regains connectivity.
  // The effect tears down its interval as soon as parsers load (length > 0).
  useEffect(() => {
    if (parsers.length > 0) return;
    const retry = () => {
      void loadParsers();
      void loadHistory();
    };
    const id = window.setInterval(retry, 20_000);
    window.addEventListener("online", retry);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", retry);
    };
  }, [parsers.length, loadParsers, loadHistory]);

  useEffect(() => {
    if (!deferredPreview) return;
    const parserKey = deferredPreview.document.parser_key;
    let next =
      deferredPreview.default_variant_key ??
      deferredPreview.preference?.preferred_variant_key ??
      allVariants[0]?.key ??
      null;
    try {
      const savedTemplateId = localStorage.getItem(`template_id_${parserKey}`);
      if (savedTemplateId) {
        const templateKey = `template::${savedTemplateId}`;
        // Шаблон помнится по шаблону разбора, а общий разбор один на физлиц
        // и юрлиц: вид физлица не должен открываться поверх «Юр счёта».
        const groupOf = (key: string | null) =>
          allVariants.find((v) => v.key === key)?.group ?? "primary";
        if (allVariants.some((v) => v.key === templateKey) && groupOf(templateKey) === groupOf(next)) {
          next = templateKey;
        }
      }
    } catch {
      // ignore localStorage errors
    }
    setSelectedVariantKey(next);
  }, [allVariants, deferredPreview]);

  useEffect(() => {
    const review = deferredPreview?.ocr_review;
    if (!review) return;
    setSelectedReviewTableIndex(review.suggested_table_index ?? review.tables[0]?.table_index ?? 0);
    setSelectedReviewHeaderRow(review.suggested_header_row_index ?? 0);
    setReviewTitle(review.source_filename);
    setReviewTemplateName(review.source_filename.replace(/\.[^.]+$/, ""));
    setReviewColumnMapping(
      Object.fromEntries(review.available_fields.map((field) => [field.key, ""])),
    );
  }, [deferredPreview?.ocr_review]);

  const loadSession = useCallback(
    async (sessionId: string) => {
      setIsLoadingSession(true);
      setError(null);
      try {
        setPreview(await fetchJson<PreviewResponse>(`${api}/api/v1/transforms/sessions/${sessionId}`));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки сессии.");
      } finally {
        setIsLoadingSession(false);
      }
    },
    [api],
  );

  const handlePreviewNow = useCallback(
    (file: File) => {
      setError(null);
      startUpload(async () => {
        try {
          const fd = new FormData();
          fd.append("file", file);
          setPreview(await fetchJson<PreviewResponse>(`${api}/api/v1/transforms/preview`, { method: "POST", body: fd }));
          await loadHistory();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Ошибка обработки.");
        }
      });
    },
    [api, loadHistory],
  );

  const handleExport = useCallback(async () => {
    if (!preview || !selectedVariantKey) return;
    setIsExporting(true);
    setError(null);
    try {
      const res = await fetch(`${api}/api/v1/transforms/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: preview.session_id,
          variant_key: selectedVariantKey,
          excluded_rows: excludedExportRows,
          custom_columns: customExportColumns ?? undefined,
          custom_rows: customExportRows ?? undefined,
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedVariantKey}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта.");
    } finally {
      setIsExporting(false);
    }
  }, [api, preview, selectedVariantKey, excludedExportRows, customExportColumns, customExportRows]);

  const handleExportCsv = useCallback(async () => {
    if (!preview || !selectedVariantKey) return;
    setIsExportingCsv(true);
    setError(null);
    try {
      const res = await fetch(`${api}/api/v1/transforms/export/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: preview.session_id, variant_key: selectedVariantKey }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedVariantKey}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка экспорта CSV.");
    } finally {
      setIsExportingCsv(false);
    }
  }, [api, preview, selectedVariantKey]);

  const handleMaterializeReview = useCallback(async () => {
    const review = preview?.ocr_review;
    if (!review) return;
    setIsMaterializingReview(true);
    setError(null);
    try {
      const res = await fetch(`${api}/api/v1/transforms/ocr-reviews/${review.review_id}/materialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          table_index: selectedReviewTableIndex,
          header_row_index: selectedReviewHeaderRow,
          title: reviewTitle,
          save_mapping_template: saveReviewTemplate,
          mapping_template_name: reviewTemplateName,
          column_mapping: Object.fromEntries(
            Object.entries(reviewColumnMapping).map(([key, value]) => [key, value === "" ? null : Number(value)]),
          ),
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setPreview((await res.json()) as PreviewResponse);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка применения OCR проверки.");
    } finally {
      setIsMaterializingReview(false);
    }
  }, [api, preview, selectedReviewTableIndex, selectedReviewHeaderRow, reviewTitle, saveReviewTemplate, reviewTemplateName, reviewColumnMapping, loadHistory]);

  const handleCompareRule = useCallback(async (): Promise<OCRRuleVersionDiff | null> => null, []);

  const handleCreateTemplate = useCallback(async (
    name: string,
    parserKey: string,
    variantKey: string,
    columns: Array<{key: string; label: string; kind: string; formula?: string | null; ai_description?: string | null}>,
  ): Promise<string | null> => {
    try {
      const res = await fetch(`${api}/api/v1/transforms/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parser_key: parserKey,
          name,
          description: "",
          base_variant_key: variantKey,
          columns: columns.map((c) => ({
            key: c.key,
            label: c.label,
            kind: c.kind,
            enabled: true,
            formula: c.formula ?? null,
            ai_description: c.ai_description ?? null,
          })),
          is_default: true,
        }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = (await res.json()) as { template_id: string };
      return data.template_id;
    } catch {
      return null;
    }
  }, [api]);

  const handleAdvisorColumn = useCallback(async (
    columnName: string,
    parserKey: string,
    sampleValues: number[] = [],
    contextColumns: Record<string, number[]> = {},
  ) => {
    try {
      const res = await fetch(`${api}/api/v1/transforms/advisor/column`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          column_name: columnName,
          parser_key: parserKey,
          sample_values: sampleValues,
          context_columns: contextColumns,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").AdvisorColumnResponse;
    } catch { return null; }
  }, [api]);

  const handleAnalyzeDiff = useCallback(async (
    originalVariantKey: string,
    editedColumns: Array<Record<string, unknown>>,
    editedRows: Array<Record<string, unknown>>,
  ) => {
    const sessionId = preview?.session_id;
    if (!sessionId) return null;
    try {
      const res = await fetch(`${api}/api/v1/transforms/analyze-diff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          original_variant_key: originalVariantKey,
          edited_columns: editedColumns,
          edited_rows: editedRows,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").AnalyzeDiffResponse;
    } catch { return null; }
  }, [api, preview]);

  const handleReAnalyze = useCallback(async (
    originalVariantKey: string,
    editedColumns: Array<Record<string, unknown>>,
    editedRows: Array<Record<string, unknown>>,
    userHint: string,
    targetColumnKey?: string | null,
  ) => {
    const sessionId = preview?.session_id;
    if (!sessionId) return null;
    try {
      const res = await fetch(`${api}/api/v1/transforms/re-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          original_variant_key: originalVariantKey,
          edited_columns: editedColumns,
          edited_rows: editedRows,
          user_hint: userHint,
          target_column_key: targetColumnKey ?? null,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").AnalyzeDiffResponse;
    } catch { return null; }
  }, [api, preview]);

  const handleSmartRefine = useCallback(async (
    originalVariantKey: string,
    editedColumns: Array<Record<string, unknown>>,
    editedRows: Array<Record<string, unknown>>,
    userHint: string,
    targetColumnKey?: string | null,
    existingFindings?: import("@/components/workbench/types").DiffFinding[] | null,
  ) => {
    const sessionId = preview?.session_id;
    if (!sessionId) return null;
    try {
      const res = await fetch(`${api}/api/v1/transforms/smart-refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          original_variant_key: originalVariantKey,
          edited_columns: editedColumns,
          edited_rows: editedRows,
          user_hint: userHint,
          target_column_key: targetColumnKey ?? null,
          existing_findings: existingFindings ?? null,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").SmartRefineResponse;
    } catch { return null; }
  }, [api, preview]);

  const handleUploadScan = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${api}/api/v1/transforms/scan`, { method: "POST", body: formData });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").ScanResponse;
    } catch { return null; }
  }, [api]);

  const handleDownloadScanDocx = useCallback((scanId: string) => {
    window.open(`${api}/api/v1/transforms/scan/${scanId}/docx`, "_blank");
  }, [api]);

  const handleScanToReview = useCallback(async (scanId: string) => {
    try {
      const res = await fetch(`${api}/api/v1/transforms/scan/${scanId}/to-review`, { method: "POST" });
      if (!res.ok) return null;
      const data = await res.json();
      return (data.review_id as string) ?? null;
    } catch { return null; }
  }, [api]);

  const handleClarify = useCallback(async (
    originalVariantKey: string,
    editedColumns: Array<Record<string, unknown>>,
    editedRows: Array<Record<string, unknown>>,
    userHint: string,
    questionRu: string,
    choiceIndex: number,
    targetColumnKey?: string | null,
    existingFindings?: import("@/components/workbench/types").DiffFinding[] | null,
  ) => {
    const sessionId = preview?.session_id;
    if (!sessionId) return null;
    try {
      const res = await fetch(`${api}/api/v1/transforms/clarify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          original_variant_key: originalVariantKey,
          edited_columns: editedColumns,
          edited_rows: editedRows,
          user_hint: userHint,
          question_ru: questionRu,
          choice_index: choiceIndex,
          target_column_key: targetColumnKey ?? null,
          existing_findings: existingFindings ?? null,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as import("@/components/workbench/types").SmartRefineResponse;
    } catch { return null; }
  }, [api, preview]);

  const handleValidateFormula = useCallback(async (formula: string) => {
    try {
      const res = await fetch(`${api}/api/v1/transforms/validate-formula`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formula }),
      });
      if (!res.ok) return { valid: false, error: "Ошибка сервера" };
      return (await res.json()) as { valid: boolean; error: string | null };
    } catch { return { valid: false, error: "Нет соединения" }; }
  }, [api]);

  const handleCompute = useCallback(async (
    variantKey: string,
    customColumns: Array<Record<string, unknown>>,
    customRows: Array<Record<string, unknown>>,
    excludedRows: number[] = [],
  ) => {
    const sessionId = preview?.session_id;
    if (!sessionId) return null;
    try {
      const res = await fetch(`${api}/api/v1/transforms/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          variant_key: variantKey,
          custom_columns: customColumns,
          custom_rows: customRows,
          excluded_rows: excludedRows,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as { columns: Array<{ key: string; label: string; kind: string }>; rows: Array<Record<string, unknown>> };
    } catch { return null; }
  }, [api, preview]);

  const setReviewColumnMappingField = useCallback((field: string, value: string) => {
    setReviewColumnMapping((prev) => ({ ...prev, [field]: value }));
  }, []);

  const ctx: WorkbenchCtx = {
    preview,
    deferredPreview,
    allVariants,
    history,
    parsers,
    selectedVariantKey,
    setSelectedVariantKey,
    selectedReviewTableIndex,
    setSelectedReviewTableIndex,
    selectedReviewHeaderRow,
    setSelectedReviewHeaderRow,
    reviewTitle,
    setReviewTitle,
    saveReviewTemplate,
    setSaveReviewTemplate,
    reviewTemplateName,
    setReviewTemplateName,
    reviewColumnMapping,
    setReviewColumnMappingField,
    excludedExportRows,
    setExcludedExportRows,
    customExportColumns,
    setCustomExportColumns,
    customExportRows,
    setCustomExportRows,
    isPending,
    isMaterializingReview,
    isExporting,
    isExportingCsv,
    isLoadingSession,
    error,
    toasts,
    dismissToast,
    handlePreviewNow,
    handleExport,
    handleExportCsv,
    handleMaterializeReview,
    handleCompareRule,
    handleCreateTemplate,
    handleAdvisorColumn,
    handleAnalyzeDiff,
    handleReAnalyze,
    handleSmartRefine,
    handleClarify,
    handleValidateFormula,
    handleCompute,
    handleUploadScan,
    handleDownloadScanDocx,
    handleScanToReview,
    loadSession,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
