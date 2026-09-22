export type PreviewColumn = {
  key: string;
  label: string;
  kind: string;
};

export type PreviewVariant = {
  key: string;
  name: string;
  description: string;
  columns: PreviewColumn[];
  rows: Array<Record<string, string | number | null>>;
  group?: string;
  template_id?: string | null;
  base_variant_key?: string | null;
};

export type PreferenceRecord = {
  parser_key: string;
  preferred_variant_key: string;
  always_show_alternatives: boolean;
  updated_at: string;
};

export type TemplateColumnConfig = {
  key: string;
  label: string;
  kind: string;
  enabled: boolean;
  formula?: string | null;        // e.g. "{amount} * 0.12"
  source_field?: string | null;   // direct mapping to transaction field
  ai_description?: string | null; // human-readable explanation
};

export type TransformationTemplate = {
  template_id: string;
  parser_key: string;
  name: string;
  description: string;
  base_variant_key: string;
  columns: TemplateColumnConfig[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type SessionSummary = {
  session_id: string;
  parser_key: string;
  source_filename: string;
  title: string;
  account_holder?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  transaction_count: number;
  created_at: string;
};

export type ParserDescriptor = {
  key: string;
  label: string;
  description: string;
  accepted_extensions: string[];
};

export type ParserMatch = {
  key: string;
  label: string;
  score: number;
  matched: boolean;
};

export type QualityFlag = {
  code: string;
  severity: "low" | "medium" | "high" | string;
  message: string;
};

export type RowDiagnostic = {
  row_number: number;
  date: string;
  operation: string;
  detail: string;
  amount: number;
  confidence: number;
  source: string;
  corrected: boolean;
  flags: QualityFlag[];
};

export type QualitySummary = {
  overall_confidence: number;
  anomaly_score: number;
  review_required_count: number;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  clean_count: number;
  corrected_count: number;
  totals_mismatch: boolean;
  recommendations: string[];
};

export type VisionStatus = {
  available: boolean;
  backend: string;
  ocr_available: boolean;
  ocr_backend: string;
  note: string;
  use_cases: string[];
};

export type OCRReviewField = {
  key: string;
  label: string;
  required: boolean;
};

export type OCRReviewTable = {
  table_index: number;
  rows: string[][];
  suggested_header_row_index?: number | null;
  cell_confidence?: Array<Array<number | null>>;
};

export type OCRReviewPayload = {
  review_id: string;
  source_filename: string;
  lines: string[];
  tables: OCRReviewTable[];
  suggested_table_index?: number | null;
  suggested_header_row_index?: number | null;
  available_fields: OCRReviewField[];
};

export type OCRMappingTemplate = {
  template_id: string;
  name: string;
  version: number;
  parser_key: string;
  status: string;
  is_active: boolean;
  header_signature: string[];
  title_keywords: string[];
  column_mapping: Record<string, number | null>;
  created_at: string;
  updated_at: string;
};

export type OCRRuleVersionDiff = {
  from_template_id: string;
  to_template_id: string;
  added_header_tokens: string[];
  removed_header_tokens: string[];
  added_title_keywords: string[];
  removed_title_keywords: string[];
  changed_columns: string[];
};

export type OCRRuleManagerSnapshot = {
  templates: OCRMappingTemplate[];
  grouped_versions: Record<string, OCRMappingTemplate[]>;
};

export type AppliedRuleInfo = {
  rule_type: string;
  template_id: string;
  name: string;
  version: number;
  score: number;
  reason: string;
  header_score: number;
  title_score: number;
  matched_header_signature: string[];
  matched_title_keywords: string[];
};

export type PreviewResponse = {
  session_id: string;
  document: {
    source_filename: string;
    title: string;
    parser_key: string;
    account_holder?: string | null;
    card_number?: string | null;
    account_number?: string | null;
    currency?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    opening_balance?: number | null;
    closing_balance?: number | null;
    transaction_count: number;
    reading_note?: string | null;
    totals: {
      income_total: number;
      expense_total: number;
      purchase_total: number;
      transfer_total: number;
      topup_total: number;
      cash_withdrawal_total: number;
    };
  };
  parser_matches: ParserMatch[];
  applied_rule?: AppliedRuleInfo | null;
  quality_summary: QualitySummary;
  row_diagnostics: RowDiagnostic[];
  ocr_review?: OCRReviewPayload | null;
  variants: PreviewVariant[];
  saved_variants: PreviewVariant[];
  templates: TransformationTemplate[];
  preference?: PreferenceRecord | null;
  default_variant_key?: string | null;
};

export type CorrectionMemoryEntry = {
  correction_id: number;
  parser_key: string;
  field_name: string;
  original_value: string;
  corrected_value: string;
  frequency: number;
  last_seen_at: string;
};

export type JobSummary = {
  job_id: string;
  job_type: string;
  status: string;
  source_filename?: string | null;
  session_id?: string | null;
  review_id?: string | null;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
  result_payload?: Record<string, unknown> | null;
};

export type OnboardingSample = {
  sample_id: string;
  project_id: string;
  source_filename: string;
  review_id?: string | null;
  session_id?: string | null;
  status: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type OnboardingProject = {
  project_id: string;
  name: string;
  bank_name: string;
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  samples: OnboardingSample[];
};

// ── Smart Brain types ──────────────────────────────────────────────────────────

export type ColumnRecommendation = {
  formula: string;
  explanation: string;
  confidence: number;
  category: "formula" | "mapping" | "aggregate" | "warning";
  source: string;
};

export type AdvisorColumnResponse = {
  recommendations: ColumnRecommendation[];
};

export type DiffFinding = {
  type:
    | "label_change"
    | "column_removed"
    | "column_added"
    | "cell_changed"
    | "row_removed"
    | "formula_detected"
    | "filter_detected";
  column_key?: string | null;
  detected_formula?: string | null;
  confidence: number;
  explanation_ru: string;
  intent?: string | null;
  needs_clarification?: boolean;
};

export type AnalyzeDiffResponse = {
  findings: DiffFinding[];
  summary_ru: string;
};

export type ConsistencyWarning = {
  type: string;
  severity: "low" | "medium" | "high";
  message_ru: string;
  affected_rows: number[];
  affected_column?: string | null;
};

export type ConsistencyReport = {
  warnings: ConsistencyWarning[];
  is_clean: boolean;
};

// ── Smart NLP Correction Engine types ─────────────────────────────────────────

export type FormulaPatch = {
  column_key: string;
  formula?: string | null;
  source_field?: string | null;
  new_label?: string | null;
  after_key?: string | null;
  filter_direction?: string | null;
  filter_threshold?: number | null;
  filter_keyword?: string | null;
};

export type ClarifyQuestion = {
  question_ru: string;
  choices: string[];
  choice_formulas: string[];
  column_key?: string | null;
};

export type SmartRefineRequest = {
  session_id: string;
  original_variant_key: string;
  edited_columns: Record<string, unknown>[];
  edited_rows: Record<string, unknown>[];
  user_hint: string;
  target_column_key?: string | null;
  existing_findings?: DiffFinding[] | null;
};

export type SmartRefineResponse = {
  findings: DiffFinding[];
  narrative_ru: string;
  clarifications: ClarifyQuestion[];
  confidence: number;
  summary_ru: string;
};

export type ClarifyRequest = {
  session_id: string;
  original_variant_key: string;
  edited_columns: Record<string, unknown>[];
  edited_rows: Record<string, unknown>[];
  user_hint: string;
  target_column_key?: string | null;
  existing_findings?: DiffFinding[] | null;
  choice_index: number;
  question_ru: string;
};

// ── Scanned document OCR types ─────────────────────────────────────────────────

export type ScanResultMeta = {
  scan_id: string;
  source_filename: string;
  page_count: number;
  avg_confidence: number;
  rotation_angles: number[];
  warnings: string[];
  tables_found: number;
};

export type ScanResponse = {
  scan_id: string;
  meta: ScanResultMeta;
  preview_tables: Array<{
    page: number;
    headers: string[];
    rows: string[][];
    confidence: number;
  }>;
};
