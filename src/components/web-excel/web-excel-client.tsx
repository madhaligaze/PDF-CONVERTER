"use client";

import dynamic from "next/dynamic";

import { TablesGate } from "./tables-gate";

// Univer references window/canvas at import time — keep it fully client-side.
// Грузится только за шлюзом: до входа раздел не тянет ни кода листа, ни данных.
const WebExcelWorkbench = dynamic(
  () => import("./web-excel-workbench").then((m) => m.WebExcelWorkbench),
  { ssr: false, loading: () => <div style={{ padding: 24 }}>Загрузка таблиц…</div> },
);

export function WebExcelClient() {
  return (
    <TablesGate>
      <WebExcelWorkbench />
    </TablesGate>
  );
}
