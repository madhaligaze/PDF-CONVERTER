/**
 * Выключатели разделов — читаются на сервере Next при каждом запросе.
 *
 * Источник один — переменная бэкенда: `BBC_DASHBOARD_ENABLED=false` в
 * переменных сервиса бэкенда на Railway выключает BBC Dashboard целиком —
 * маршруты `/bbc/*` отвечают 404, фоновый цикл не стартует, а фронт убирает
 * плитку из «Сервисов» и уводит с `/bbc-dashboard`. Второй переменной на
 * фронте нет, пересборки тоже: смена переменной перезапускает только бэкенд.
 *
 * Бэкенд не ответил — раздел считается включённым: выключатель нужен, чтобы
 * убрать раздел, а не чтобы прятать его при любой заминке сети.
 */
function backendBaseUrl(): string {
  const raw = (process.env.API_URL || "http://localhost:8000").trim().replace(/^["']|["']$/g, "");
  return raw.replace(/\/$/, "");
}

export async function bbcEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${backendBaseUrl()}/api/v1/bbc/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return true;
    const body = (await response.json()) as { enabled?: boolean };
    return body.enabled !== false;
  } catch {
    return true;
  }
}
