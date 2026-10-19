import { SectionBar } from "@/components/stage/section-bar";

/**
 * Раздел вынесен в отдельное приложение. Надпись в списке сервисов остаётся,
 * маршрута в журнал больше нет: эта страница только объясняет, почему строка
 * не открывается.
 */
export default function FinanceRetiredPage() {
  return (
    <div className="page-shell">
      <SectionBar backHref="/services" backLabel="Сервисы" />
      <main className="page-main">
        <p className="annot">Отдельное приложение</p>
        <h1 className="headline">Финансы</h1>
        <p className="page-note">Раздел больше не входит в это приложение.</p>
      </main>
    </div>
  );
}
