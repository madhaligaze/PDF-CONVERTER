import type { WorkbookSnapshot } from "@/components/univer/sheet";

import type { SheetInfo } from "./workbook";

const API = "/api/backend/api/v1/web-excel";

export type TableSource = "blank" | "google" | "file";

export type ShelfItem = {
  id: number;
  name: string;
  source: TableSource;
  source_ref: string;
  sheets: SheetInfo[];
  size_bytes: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ShelfTable = ShelfItem & { snapshot: WorkbookSnapshot };

export type SavePayload = {
  name?: string;
  source?: TableSource;
  source_ref?: string;
  sheets?: SheetInfo[];
  snapshot?: WorkbookSnapshot;
};

/**
 * Ошибка сервера — его же фразой из `detail` («Таблица весит 23 МБ — на полку
 * помещается до 20 МБ»), а не «HTTP 413», по которой не понять, что делать.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new Error("Сервер не отвечает — проверьте сеть");
  }
  if (!response.ok) {
    let detail = `Сервер ответил ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* тело не JSON — остаётся код статуса */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

/**
 * Снимок уходит на сервер строкой и строкой же возвращается: сервер его не
 * разбирает (разбор таблицы на 20 МБ стоил бы ему 200 МБ памяти).
 */
function body(payload: SavePayload): string {
  const { snapshot, ...rest } = payload;
  return JSON.stringify(snapshot === undefined ? rest : { ...rest, snapshot: JSON.stringify(snapshot) });
}

export const shelfApi = {
  list: () => request<{ tables: ShelfItem[] }>("/shelf").then((data) => data.tables),
  open: async (id: number): Promise<ShelfTable> => {
    const table = await request<ShelfItem & { snapshot: string }>(`/shelf/${id}`);
    let snapshot: WorkbookSnapshot;
    try {
      snapshot = JSON.parse(table.snapshot);
    } catch {
      throw new Error("Снимок таблицы повреждён");
    }
    return { ...table, snapshot };
  },
  create: (payload: SavePayload) => request<ShelfItem>("/shelf", { method: "POST", body: body(payload) }),
  save: (id: number, payload: SavePayload) =>
    request<ShelfItem>(`/shelf/${id}`, { method: "PUT", body: body(payload) }),
  copy: (id: number) => request<ShelfItem>(`/shelf/${id}/copy`, { method: "POST" }),
  remove: (id: number) => request<{ ok: boolean }>(`/shelf/${id}`, { method: "DELETE" }),
};
