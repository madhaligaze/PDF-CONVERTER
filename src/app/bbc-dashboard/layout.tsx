import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { bbcEnabled } from "@/lib/features";

/**
 * BBC Dashboard выключается переменной бэкенда `BBC_DASHBOARD_ENABLED=false`
 * (см. `src/lib/features.ts`): тогда и дашборд, и его личный кабинет уводят
 * в «Сервисы». Проверка — на каждый запрос, не при сборке: иначе значение
 * переменной запеклось бы в страницу до следующего деплоя фронта.
 */
export const dynamic = "force-dynamic";

export default async function BbcDashboardLayout({ children }: { children: ReactNode }) {
  if (!(await bbcEnabled())) redirect("/services");
  return children;
}
