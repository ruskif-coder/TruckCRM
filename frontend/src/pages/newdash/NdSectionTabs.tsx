/**
 * NdSectionTabs — переключатель вкладок раздела (сегмент-контрол из хендоффа).
 * Рисуется между шапкой и контентом. Навигация по отдельным URL под-страниц.
 */
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export type SectionTab = { label: string; to: string };

// Вкладки раздела «Рейсы»
export const TRIPS_TABS: SectionTab[] = [
  { label: "Реестр поездок", to: "/newdash/trips" },
  { label: "Пробеги", to: "/newdash/trips/mileage" },
  { label: "Приёмка-сдача", to: "/newdash/trips/acts" },
];

// Вкладки раздела «Финансы»
export const FINANCE_TABS: SectionTab[] = [
  { label: "Реестр расходов", to: "/newdash/finance" },
  { label: "Топливо", to: "/newdash/finance/fuel" },
  { label: "Заявки", to: "/newdash/finance/claims" },
];

// Вкладки раздела «Отчёты»
export const REPORTS_TABS: SectionTab[] = [
  { label: "Отчёты", to: "/newdash/reports" },
  { label: "Перевозчики", to: "/newdash/reports/carriers" },
];

// Вкладки раздела «Справочники»
export const REFS_TABS: SectionTab[] = [
  { label: "Перевозчики", to: "/newdash/refs" },
  { label: "Контрагенты", to: "/newdash/refs/counterparties" },
];

// Вкладки раздела «Настройки» (Профиль — всем ролям, остальные — admin;
// фильтрация по роли в NewDashSettingsShell)
export const SETTINGS_TABS: SectionTab[] = [
  { label: "Профиль", to: "/newdash/settings" },
  { label: "Пользователи", to: "/newdash/settings/users" },
  { label: "Роли", to: "/newdash/settings/roles" },
  { label: "Журнал", to: "/newdash/settings/log" },
  { label: "Статьи", to: "/newdash/settings/categories" },
];

export default function NdSectionTabs({ tabs, right }: { tabs: SectionTab[]; right?: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <div className="section-tabs">
      <div className="segments">
        {tabs.map(t => (
          <button
            key={t.to}
            className="segments__item"
            style={{ padding: "8px 18px", fontSize: 13 }}
            aria-selected={pathname === t.to}
            onClick={() => navigate(t.to)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {right && <><div className="spacer" /><div className="section-tabs__right">{right}</div></>}
    </div>
  );
}
