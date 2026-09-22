import type { OCRReviewPayload } from "@/components/workbench/types";
import { SectionCard } from "@/components/workbench/section-card";

type Props = {
  review: OCRReviewPayload | null;
  selectedTableIndex: number;
  selectedHeaderRow: number;
  reviewTitle: string;
  reviewTemplateName: string;
  saveTemplate: boolean;
  columnMapping: Record<string, string>;
  busy: boolean;
  onTableChange: (value: number) => void;
  onHeaderRowChange: (value: number) => void;
  onReviewTitleChange: (value: string) => void;
  onReviewTemplateNameChange: (value: string) => void;
  onSaveTemplateChange: (value: boolean) => void;
  onColumnMappingChange: (field: string, value: string) => void;
  onMaterialize: () => void;
};

export function OcrReviewPanel({
  review,
  selectedTableIndex,
  selectedHeaderRow,
  reviewTitle,
  reviewTemplateName,
  saveTemplate,
  columnMapping,
  busy,
  onTableChange,
  onHeaderRowChange,
  onReviewTitleChange,
  onReviewTemplateNameChange,
  onSaveTemplateChange,
  onColumnMappingChange,
  onMaterialize,
}: Props) {
  if (!review) return null;

  const table = review.tables.find((t) => t.table_index === selectedTableIndex) ?? review.tables[0];
  const columnCount = Math.max(...(table?.rows.map((r) => r.length) ?? [0]));

  return (
    <SectionCard
      title="Проверка OCR"
      subtitle="Сопоставьте столбцы банковской выписки"
    >
      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        {/* Table preview */}
        <div
          className="overflow-hidden rounded-[var(--radius-inner)]"
          style={{ border: "1px solid var(--border-base)" }}
        >
          <div className="overflow-x-auto max-h-96">
            <table className="min-w-full text-xs">
              <tbody>
                {table?.rows.map((row, rowIndex) => (
                  <tr
                    key={`${table.table_index}-${rowIndex}`}
                    style={{
                      background:
                        rowIndex === selectedHeaderRow
                          ? "rgba(59,130,246,0.10)"
                          : undefined,
                      borderTop: rowIndex > 0 ? "1px solid var(--border-subtle)" : undefined,
                    }}
                  >
                    <td
                      className="px-2 py-1.5 font-mono w-6"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {rowIndex + 1}
                    </td>
                    {Array.from({ length: columnCount }).map((_, colIndex) => (
                      <td
                        key={colIndex}
                        className="px-3 py-1.5"
                        style={{ color: "var(--text-primary)" }}
                      >
                        <div>{row[colIndex] || "—"}</div>
                        {table.cell_confidence?.[rowIndex]?.[colIndex] != null ? (
                          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {Math.round((table.cell_confidence[rowIndex][colIndex] ?? 0) * 100)}%
                          </div>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Таблица
              <select
                className="input-field mt-1"
                value={selectedTableIndex}
                onChange={(e) => onTableChange(Number(e.target.value))}
              >
                {review.tables.map((t) => (
                  <option key={t.table_index} value={t.table_index}>
                    Таблица {t.table_index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs" style={{ color: "var(--text-secondary)" }}>
              Строка заголовка
              <select
                className="input-field mt-1"
                value={selectedHeaderRow}
                onChange={(e) => onHeaderRowChange(Number(e.target.value))}
              >
                {(table?.rows ?? []).map((_, i) => (
                  <option key={i} value={i}>Строка {i + 1}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
            Название
            <input
              className="input-field mt-1"
              value={reviewTitle}
              onChange={(e) => onReviewTitleChange(e.target.value)}
            />
          </label>

          <div className="card-inner p-3">
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
              Сопоставление столбцов
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {review.available_fields.map((field) => (
                <label key={field.key} className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {field.label}
                  {field.required ? <span className="ml-0.5" style={{ color: "var(--accent-rose)" }}>*</span> : null}
                  <select
                    className="input-field mt-1"
                    value={columnMapping[field.key] ?? ""}
                    onChange={(e) => onColumnMappingChange(field.key, e.target.value)}
                  >
                    <option value="">Не сопоставлено</option>
                    {Array.from({ length: columnCount }).map((_, i) => (
                      <option key={i} value={String(i)}>Стб. {i + 1}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <label
            className="flex cursor-pointer items-center gap-2 card-inner px-3 py-2.5 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            <input
              type="checkbox"
              className="accent-blue-500"
              checked={saveTemplate}
              onChange={(e) => onSaveTemplateChange(e.target.checked)}
            />
            Сохранить как правило OCR
          </label>

          {saveTemplate && (
            <label className="block text-xs" style={{ color: "var(--text-secondary)" }}>
              Название правила
              <input
                className="input-field mt-1"
                value={reviewTemplateName}
                onChange={(e) => onReviewTemplateNameChange(e.target.value)}
              />
            </label>
          )}

          <button
            className="btn-primary w-full"
            disabled={busy}
            onClick={onMaterialize}
            type="button"
          >
            {busy ? "Применение…" : "Применить"}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
