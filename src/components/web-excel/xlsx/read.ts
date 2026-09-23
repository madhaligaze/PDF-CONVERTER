/**
 * Чтение книги .xlsx в фоновом потоке: сначала оглавление, потом выбранные листы.
 */
import type { ImportedSheet, SheetSummary, WorkerRequest, WorkerResponse } from "./types";

/** Дольше этого разбор не ждём: книга, которая читается минуту, уже не откроется удобно. */
const TIMEOUT_MS = 90_000;

export type XlsxBook = {
  title: string;
  sheets: SheetSummary[];
  /** Перевести выбранные листы в формат Univer. */
  convert: (names: string[]) => Promise<ImportedSheet[]>;
  /** Отпустить поток и книгу в нём. */
  close: () => void;
};

export async function openXlsx(buffer: ArrayBuffer): Promise<XlsxBook> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  const ask = <K extends WorkerResponse["kind"]>(
    request: WorkerRequest,
    expected: K,
    transfer: Transferable[] = [],
  ): Promise<Extract<WorkerResponse, { kind: K }>> =>
    new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        worker.terminate();
        reject(new Error("Файл читается слишком долго — вероятно, он слишком большой"));
      }, TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        window.clearTimeout(timer);
        const message = event.data;
        if (message.kind === "failed") reject(new Error(humanize(message.message)));
        else if (message.kind === expected) resolve(message as Extract<WorkerResponse, { kind: K }>);
        else reject(new Error("Файл не читается"));
      };
      worker.onerror = (event) => {
        window.clearTimeout(timer);
        reject(new Error(humanize(event.message || "")));
      };
      worker.postMessage(request, transfer);
    });

  try {
    const loaded = await ask({ kind: "load", buffer }, "loaded", [buffer]);
    return {
      title: loaded.title,
      sheets: loaded.sheets,
      convert: async (names) => (await ask({ kind: "convert", names }, "converted")).sheets,
      close: () => worker.terminate(),
    };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}

function humanize(message: string): string {
  if (/zip|central directory|signature|corrupt/i.test(message)) {
    return "Это не книга .xlsx или файл повреждён";
  }
  return message || "Файл не читается";
}
