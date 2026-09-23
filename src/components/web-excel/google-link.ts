/**
 * Книга Google Sheets по ссылке — выгрузкой .xlsx прямо в браузер.
 *
 * Без сервисного аккаунта и без сервера. Google отдаёт выгрузку таблицы,
 * открытой по ссылке, с заголовками CORS (и на переадресации, и на самом
 * файле — проверено 23.09.2026), так что книга едет из Google в браузер и
 * разбирается там же. Сервер программы её не видит и памяти на неё не тратит.
 *
 * Закрытую таблицу так не прочитать — это и есть граница: раздел открыт без
 * входа, и читать чужие закрытые книги от имени программы он не должен.
 */

/** Выгрузка больше этого — уже не таблица для правки в браузере. */
const MAX_BYTES = 40 * 1024 * 1024;

const CLOSED =
  "Таблица закрыта. В Google откройте «Настройки доступа» → «Все, у кого есть ссылка» " +
  "или скачайте её как .xlsx и откройте файлом";

/** Id книги из ссылки вида …/spreadsheets/d/<id>/edit#gid=0 или сам id. */
export function spreadsheetIdOf(input: string): string | null {
  const text = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(text) ? text : null;
}

export function sheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function titleOf(disposition: string | null): string {
  if (!disposition) return "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  let name = "";
  if (encoded) {
    try {
      name = decodeURIComponent(encoded[1]);
    } catch {
      name = encoded[1];
    }
  } else {
    name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "";
  }
  return name.replace(/\.xlsx$/i, "").trim();
}

export async function downloadGoogleSheet(id: string): Promise<{ buffer: ArrayBuffer; title: string }> {
  let response: Response;
  try {
    response = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, {
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    // Закрытая таблица уводит на страницу входа Google без заголовков CORS —
    // браузер видит это как сетевой отказ. Отличить его от «нет сети» нельзя.
    throw new Error(navigator.onLine === false ? "Нет сети" : CLOSED);
  }

  if (response.status === 404) throw new Error("Таблица не найдена — проверьте ссылку");
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || type.includes("text/html")) throw new Error(CLOSED);

  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("Таблица больше 40 МБ — откройте её по частям");

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new Error("Таблица больше 40 МБ — откройте её по частям");
  return { buffer, title: titleOf(response.headers.get("content-disposition")) };
}
