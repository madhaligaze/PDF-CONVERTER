"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useStageHold } from "@/components/motion/stage-transition";

// Univer references window/canvas at import time — keep it fully client-side.
const WebExcelWorkbench = dynamic(
  () => import("./web-excel-workbench").then((m) => m.WebExcelWorkbench),
  { ssr: false, loading: () => <p className="we-grid-wait">Загружаем таблицы…</p> },
);

/**
 * «Таблицы» открыты без входа: это место для своих таблиц, а не зеркало чужих
 * книг. Раньше раздел стоял за входом дашборда BBC, потому что показывал его
 * «Журнал» и реестр продаж; теперь чужих книг здесь нет вовсе.
 *
 * Занавес перехода держится, пока лист не нарисован: код Univer и сборка
 * книги занимают главный поток на полсекунды и больше, и подъём занавеса
 * поверх этой работы шёл рывками.
 */
export function WebExcelClient() {
  const [shown, setShown] = useState(false);
  useStageHold(!shown);
  return <WebExcelWorkbench onShown={() => setShown(true)} />;
}
