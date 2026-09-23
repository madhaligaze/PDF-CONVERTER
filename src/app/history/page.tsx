import { StatementWorkbench } from "@/components/statement-workbench";

export const dynamic = "force-dynamic";

/**
 * «История» — та же мастерская, открытая сразу на панели истории.
 *
 * Отдельного экрана у истории нет намеренно: она нужна ровно для того, чтобы
 * открыть разобранную выписку, а открывается выписка в мастерской. Свой экран
 * означал бы вторую копию таблицы вариантов.
 */
export default function HistoryPage() {
  return <StatementWorkbench apiBaseUrl="/api/backend" openHistory />;
}
