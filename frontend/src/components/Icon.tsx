// Лёгкий собственный line-set, портирован из
// design_handoff_fleet_dashboard/reference/fleet-components.jsx (PATHS).
export type IconName =
  | "grid" | "list" | "truck" | "van" | "car" | "users" | "gauge" | "fuel" | "route"
  | "wrench" | "bell" | "search" | "filter" | "calendar" | "plus"
  | "chevr" | "chevd" | "arrowup" | "arrowdown" | "arrowdr" | "expand"
  | "cog" | "star" | "doc" | "chat" | "mail" | "download" | "shield" | "folder" | "ruble"
  | "clipboard" | "logout";

const PATHS: Record<IconName, string> = {
  grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  list: "M4 6h16M4 12h16M4 18h16",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7zM7.5 19a2 2 0 100-4 2 2 0 000 4zM17.5 19a2 2 0 100-4 2 2 0 000 4z",
  users: "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20a6 6 0 0112 0M17 12a3 3 0 10-1-5.83M16 20h5a5 5 0 00-3-4.58",
  gauge: "M12 13l4-4M21 12a9 9 0 10-18 0M12 21a9 9 0 01-9-9M12 21a9 9 0 009-9",
  doc: "M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6",
  chat: "M4 5h16v11H9l-4 4v-4H4z",
  cog: "M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1",
  bell: "M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 004 0",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4-4",
  filter: "M3 5h18M7 12h10M10 19h4",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  plus: "M12 5v14M5 12h14",
  chevd: "M6 9l6 6 6-6",
  chevr: "M9 6l6 6-6 6",
  arrowup: "M12 19V5M6 11l6-6 6 6",
  arrowdr: "M7 17L17 7M9 7h8v8",
  arrowdown: "M12 5v14M6 13l6 6 6-6",
  expand: "M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5",
  fuel: "M5 21V5a2 2 0 012-2h6a2 2 0 012 2v16M3 21h14M15 9h2a2 2 0 012 2v5a2 2 0 002 2M8 8h6",
  route: "M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h7a3 3 0 003-3V9M6 15V7",
  wrench: "M14 7a4 4 0 01-5 5l-5 5 2 2 5-5a4 4 0 015-5l-2 2-2-2 2-2z",
  star: "M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.9 6.7 19.5l1.1-6L3.4 9.3l6-.8z",
  van: "M3 7h10v9H3zM13 11h4l3 3v2h-7zM7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z",
  car: "M5 11l1.5-4h11L19 11M3 16h18M3 16v-5h18v5M3 16v2M21 16v2M7 16a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 16a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  download: "M12 3v12M7 11l5 5 5-5M4 21h16",
  // Добавлена 2026-06-28 для пункта меню «Пользователи» (роли/доступ) -
  // остальные иконки уже заняты другими разделами (users — Водители,
  // wrench — Настройки).
  shield: "M12 3l8 4v5c0 5-3.4 8.4-8 9.5-4.6-1.1-8-4.5-8-9.5V7z M9 12l2 2 4-4",
  // Добавлена 2026-06-28 для пункта меню «Справочники» (объединяет
  // Автомобили + Водители - см. AppShell.tsx и pages/Directories.tsx).
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  // Добавлена 2026-06-28 для кнопки «Зафиксировать выплату водителю» на
  // странице Отчёты (план "кабинет водителя", п.3 доработка) - стилизованный
  // знак ₽: стебель на всю высоту, петля сверху, две перекладины снизу.
  ruble: "M6 3h5a4 4 0 010 8H6M6 3v18M3 12h7M3 16h7",
  // Добавлена 2026-07-03 для пункта меню «Ремонт» (журнал заявок на ремонт).
  clipboard: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
  // Добавлена 2026-07-05 для пункта «Выйти» в меню профиля (AppShell.tsx).
  // Стрелка вправо с дверным проёмом: классическая иконка выхода.
  logout: "M14 8l4 4-4 4M18 12H9M9 5H5a2 2 0 00-2 2v10a2 2 0 002 2h4",
};

const SOLID: Partial<Record<IconName, true>> = { grid: true };

export default function Icon({
  name,
  size = 20,
  stroke = 1.7,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
}) {
  const d = PATHS[name] || "";
  if (SOLID[name]) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d={d} />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
