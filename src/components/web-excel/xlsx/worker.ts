/// <reference lib="webworker" />
/**
 * Поток разбора .xlsx. Книга читается один раз и живёт здесь, пока человек
 * выбирает листы: второй разбор того же файла ради выбранных листов стоил бы
 * ещё столько же секунд.
 *
 * Отдельным потоком, а не на странице: ExcelJS раскладывает каждое правило
 * проверки данных на все его клетки, и правило на целую колонку — это миллион
 * записей. На странице это повесило бы вкладку без возможности прервать;
 * поток страница просто гасит по таймауту (`read.ts`).
 */
import ExcelJS from "exceljs";

import { convertSheet, summarize } from "./convert";
import type { WorkerRequest, WorkerResponse } from "./types";

let workbook: ExcelJS.Workbook | null = null;

function reply(message: WorkerResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "load") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(request.buffer);
      workbook = book;
      const title = book.title || book.worksheets[0]?.name || "Таблица";
      reply({ kind: "loaded", title, sheets: summarize(book) });
      return;
    }

    if (!workbook) throw new Error("Файл ещё не прочитан");
    const taken = new Set(request.names);
    const sheets = request.names
      .map((name) => workbook?.getWorksheet(name))
      .filter((sheet): sheet is ExcelJS.Worksheet => Boolean(sheet))
      .map((sheet, index) => convertSheet(workbook as ExcelJS.Workbook, sheet, index, taken));
    reply({ kind: "converted", sheets });
  } catch (error) {
    reply({
      kind: "failed",
      message: error instanceof Error ? error.message : "Файл не читается",
    });
  }
};
