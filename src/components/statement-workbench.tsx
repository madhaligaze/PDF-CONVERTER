"use client";

import { useState } from "react";

import { WorkbenchProvider, useWorkbench } from "@/components/workbench/context";
import { ToastContainer } from "@/components/workbench/toast";
import { UploadPanel } from "@/components/workbench/upload-panel";
import { HistoryPanel } from "@/components/workbench/history-panel";
import { QualityPanel } from "@/components/workbench/quality-panel";
import { VariantPreviewPanel } from "@/components/workbench/variant-preview-panel";
import { OcrReviewPanel } from "@/components/workbench/ocr-review-panel";
import { TableIcon, AlertIcon, ScanIcon, CloseIcon } from "@/components/icons";
import { SplitReveal } from "@/components/motion/split-reveal";
import { SectionBar } from "@/components/stage/section-bar";
import { ThemeToggle } from "@/components/stage/theme-toggle";

type Tab = "table" | "quality" | "ocr";

const TABS: { key: Tab; label: string; shortLabel: string; Icon: typeof TableIcon }[] = [
  { key: "table", label: "Транзакции", shortLabel: "Список", Icon: TableIcon },
  { key: "quality", label: "Качество", shortLabel: "Качество", Icon: AlertIcon },
  { key: "ocr", label: "Распознавание", shortLabel: "Скан", Icon: ScanIcon },
];

function WorkbenchInner({ openHistory = false }: { openHistory?: boolean }) {
  const {
    deferredPreview,
    allVariants,
    history,
    parsers,
    error,
    isLoadingSession,
    loadSession,
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
    isMaterializingReview,
    handleMaterializeReview,
  } = useWorkbench();

  const [tab, setTab] = useState<Tab>("table");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [showHistory, setShowHistory] = useState(openHistory);

  const hasPreview = Boolean(deferredPreview?.session_id);
  const hasOcrReview = Boolean(deferredPreview?.ocr_review);
  const heading = hasPreview ? "Разбор выписки" : "Загрузите выписку";

  const visibleTabs = TABS.filter((item) => {
    if (item.key === "quality" && !hasPreview) return false;
    if (item.key === "ocr" && !hasOcrReview) return false;
    return true;
  });

  const tabBadge = (key: Tab): string | null => {
    if (key === "quality" && deferredPreview?.quality_summary.high_risk_count) {
      return String(deferredPreview.quality_summary.high_risk_count);
    }
    if (key === "ocr" && hasOcrReview) return "!";
    return null;
  };

  // svh, а не dvh: снизу закреплён таб-бар, а при dvh высота раскладки едет
  // вместе с исчезающей адресной строкой Safari.
  return (
    <div className="min-h-screen min-h-[100svh] flex flex-col" style={{ background: "var(--page-bg)" }}>
      {/* Ссылок на другие разделы здесь нет намеренно: разделы равны, и
          переход между ними идёт через стартовый экран. Кнопки «Таблицы»,
          «Сервисы» и «История» в шапке анализатора делали его главным, а
          остальные — его подразделами; ровно от этого и уходили, когда
          появился стартовый экран. */}
      <SectionBar>
        <ThemeToggle />
      </SectionBar>

      <div className="wb-head max-w-6xl w-full mx-auto">
        <p className="annot">Анализатор выписок</p>
        {/* key по тексту обязателен: SplitText переписывает DOM надписи, и
            сменить её текст на месте React уже не сможет — только пересоздать. */}
        <SplitReveal key={heading} as="h1" className="headline">
          {heading}
        </SplitReveal>
      </div>

      <div className="hidden sm:block max-w-6xl w-full mx-auto px-6">
        <nav className="wb-tabs">
          {visibleTabs.map((item) => {
            const badge = tabBadge(item.key);
            return (
              <button
                key={item.key}
                className={`wb-tab ${tab === item.key ? "tab-active" : "tab-inactive"}`}
                onClick={() => setTab(item.key)}
                type="button"
              >
                <item.Icon size={15} />
                {item.label}
                {badge && <span className="badge badge-rose text-[0.6rem]">{badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="px-4 pt-4 pb-2 max-w-6xl w-full mx-auto">
        <UploadPanel file={localFile} parsers={parsers} onFileChange={setLocalFile} />
      </div>

      {error && (
        <div className="mx-4 mb-2 max-w-6xl mx-auto rounded-2xl banner-rose px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <main className="flex-1 px-4 sm:px-6 py-4 sm:py-5 max-w-6xl w-full mx-auto space-y-4 pb-24 sm:pb-8">
        {tab === "table" && hasPreview && (
          <div className="animate-fade-in">
            <VariantPreviewPanel variants={allVariants} diagnostics={deferredPreview?.row_diagnostics ?? []} />
          </div>
        )}

        {tab === "quality" && hasPreview && (
          <div className="animate-fade-in">
            <QualityPanel summary={deferredPreview?.quality_summary ?? null} diagnostics={deferredPreview?.row_diagnostics ?? []} />
          </div>
        )}

        {tab === "ocr" && (
          <div className="animate-fade-in">
            {hasOcrReview ? (
              <OcrReviewPanel
                busy={isMaterializingReview}
                columnMapping={reviewColumnMapping}
                onColumnMappingChange={setReviewColumnMappingField}
                onHeaderRowChange={setSelectedReviewHeaderRow}
                onMaterialize={handleMaterializeReview}
                onReviewTemplateNameChange={setReviewTemplateName}
                onReviewTitleChange={setReviewTitle}
                onSaveTemplateChange={setSaveReviewTemplate}
                onTableChange={setSelectedReviewTableIndex}
                review={deferredPreview?.ocr_review ?? null}
                reviewTemplateName={reviewTemplateName}
                reviewTitle={reviewTitle}
                saveTemplate={saveReviewTemplate}
                selectedHeaderRow={selectedReviewHeaderRow}
                selectedTableIndex={selectedReviewTableIndex}
              />
            ) : (
              <div className="card p-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                Распознавание не требуется для этого документа.
              </div>
            )}
          </div>
        )}
      </main>

      {showHistory && (
        <>
          <div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
            onClick={() => setShowHistory(false)}
          />
          <aside
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col overflow-hidden"
            style={{ background: "var(--surface)", borderLeft: "1px solid var(--border-subtle)" }}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
              style={{ background: "var(--header-bg)", borderColor: "var(--border-subtle)" }}
            >
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                История сессий
              </span>
              <button
                className="btn-ghost px-2 py-2"
                onClick={() => setShowHistory(false)}
                type="button"
                aria-label="Закрыть"
              >
                <CloseIcon size={16} />
              </button>
            </div>
            <div
              className="flex-1 overflow-y-auto p-4 space-y-4"
              style={{ paddingBottom: "max(2rem, var(--safe-b))" }}
            >
              <HistoryPanel
                history={history}
                loading={isLoadingSession}
                onOpen={(id) => { loadSession(id); setTab("table"); setShowHistory(false); }}
              />
            </div>
          </aside>
        </>
      )}

      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-50 flex border-t"
        style={{
          background: "var(--header-bg)",
          borderColor: "var(--border-subtle)",
          backdropFilter: "blur(12px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {visibleTabs.map((item) => {
          const badge = tabBadge(item.key);
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 relative"
              style={{
                color: active ? "var(--text-primary)" : "var(--text-muted)",
                minHeight: "56px",
              }}
              onClick={() => setTab(item.key)}
              type="button"
            >
              <item.Icon size={19} />
              <span className="text-[10px] leading-tight">{item.shortLabel}</span>
              {badge && (
                <span
                  className="absolute top-1.5 right-1/4 h-4 min-w-4 px-1 rounded-full text-[9px] flex items-center justify-center font-bold"
                  style={{ background: "var(--accent-rose)", color: "var(--accent-fg)" }}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <ToastContainer />
    </div>
  );
}

type StatementWorkbenchProps = {
  apiBaseUrl: string;
  /** Открыть панель истории сразу — для маршрута /history. */
  openHistory?: boolean;
};

export function StatementWorkbench({ apiBaseUrl, openHistory }: StatementWorkbenchProps) {
  return (
    <WorkbenchProvider apiBaseUrl={apiBaseUrl}>
      <WorkbenchInner openHistory={openHistory} />
    </WorkbenchProvider>
  );
}
