/* =================================================================
   Transport CRM — Icon Set
   SVG 18×18, stroke: currentColor, fill: none, stroke-width: 1.5
   Источник: design_handoff_fleet_crm/README.md → Иконки
   ================================================================= */

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function IconDashboard({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="2" y="2" width="6" height="6" rx="1.5"/><rect x="10" y="2" width="6" height="6" rx="1.5"/><rect x="2" y="10" width="6" height="6" rx="1.5"/><rect x="10" y="10" width="6" height="6" rx="1.5"/></svg>;
}

export function IconTrips({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="4" cy="14" r="1.5"/><circle cx="14" cy="14" r="1.5"/><path d="M2 14H1v-4l3-5h9l3 5v4h-1"/><path d="M5.5 9h7"/></svg>;
}

export function IconTruck({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="1" y="6" width="10" height="8" rx="1"/><path d="M11 9h4l2 3v2h-6V9z"/><circle cx="4.5" cy="14.5" r="1.5"/><circle cx="13.5" cy="14.5" r="1.5"/></svg>;
}

export function IconDrivers({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="9" cy="6" r="3"/><path d="M3 17c0-3.314 2.686-6 6-6s6 2.686 6 6"/></svg>;
}

export function IconFinance({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="2" y="4" width="12" height="9" rx="1.5"/><circle cx="14" cy="11" r="3" fill="var(--surface)"/><path d="M13 11h2M14 10v2"/></svg>;
}

export function IconFuel({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="3" y="2" width="8" height="14" rx="1.5"/><path d="M11 6h2a2 2 0 0 1 2 2v3a1 1 0 0 0 2 0V7l-2-2"/></svg>;
}

export function IconRepairs({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M14.5 3.5a3 3 0 0 1 0 4.243L6.243 16H2v-4.243L10.257 3.5a3 3 0 0 1 4.243 0z"/></svg>;
}

// База 24×24 (для иконок, взятых из общего набора) — обводка 2 при 24 = 1.5 при 18.
const base24 = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24",
  fill: "none" as const, stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

// Спидометр (пробег)
export function IconGauge({ size = 18, ...p }: IconProps) {
  return <svg {...base24(size)} {...p}><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>;
}

// Рубль (расход)
export function IconRuble({ size = 18, ...p }: IconProps) {
  return <svg {...base24(size)} {...p}><path d="M9 4v16"/><path d="M9 4h4.2a4 4 0 0 1 0 8H9"/><path d="M5.5 15h7.5"/></svg>;
}

// Гаечный ключ (ремонт)
export function IconWrench({ size = 18, ...p }: IconProps) {
  return <svg {...base24(size)} {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
}

export function IconReports({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="3" y="2" width="12" height="14" rx="1.5"/><path d="M6 6h6M6 9h6M6 12h4"/></svg>;
}

export function IconSettings({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M3 6h12M3 12h12"/><circle cx="7" cy="6" r="2" fill="var(--surface)"/><circle cx="11" cy="12" r="2" fill="var(--surface)"/></svg>;
}

export function IconSearch({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="8" cy="8" r="5"/><path d="m14 14 2 2"/></svg>;
}

export function IconBell({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 2a6 6 0 0 1 6 6v3l1.5 2H1.5L3 11V8a6 6 0 0 1 6-6z"/><path d="M7.5 16a1.5 1.5 0 0 0 3 0"/></svg>;
}

export function IconCalendar({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="2" y="3" width="14" height="13" rx="1.5"/><path d="M6 2v2M12 2v2M2 7h14"/></svg>;
}

export function IconExport({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 2v10M5 8l4 4 4-4"/><path d="M3 14h12"/></svg>;
}

export function IconPin({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M12 2L10 6l-2 .5L5 4 3 7l3.5 2-.5 4 3-3 3.5 3.5 1-1L11 9l3.5-1L12 2z"/><path d="M8 10l-5 5"/></svg>;
}

export function IconMenu({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="2" y="2" width="6" height="14" rx="1"/><path d="M12 6h4M12 9h4M12 12h4"/></svg>;
}

export function IconClose({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M4 4l10 10M14 4L4 14"/></svg>;
}

export function IconChevronDown({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M4 7l5 5 5-5"/></svg>;
}

export function IconChevronRight({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M7 4l5 5-5 5"/></svg>;
}

export function IconCheck({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M3 9l4 4 8-8"/></svg>;
}

export function IconPlus({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 4v10M4 9h10"/></svg>;
}

export function IconEdit({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M11 3l4 4-9 9H2v-4l9-9z"/></svg>;
}

export function IconTrash({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M3 5h12M8 5V3h2v2M5 5l1 11h6l1-11"/></svg>;
}

export function IconPhone({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M5 2h3l1.5 3.5-2 1.5a10 10 0 0 0 3.5 3.5l1.5-2L16 10v3c0 1.1-.9 2-2 2A14 14 0 0 1 3 4c0-1.1.9-2 2-2z"/></svg>;
}

export function IconMoon({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M16 11.5A7 7 0 0 1 6.5 2a7 7 0 1 0 9.5 9.5z"/></svg>;
}

export function IconSun({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="9" cy="9" r="3"/><path d="M9 2v1M9 15v1M2 9h1M15 9h1M4.2 4.2l.8.8M13 13l.8.8M4.2 13.8l.8-.8M13 5l.8-.8"/></svg>;
}

export function IconLogout({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M11 9H3M7 5l-4 4 4 4"/><path d="M11 3h4v12h-4"/></svg>;
}

export function IconWarning({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 2L1.5 15h15L9 2z"/><path d="M9 8v3M9 13.5v.5"/></svg>;
}

export function IconDots({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="5" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="13" cy="9" r="1" fill="currentColor"/></svg>;
}

export function IconArrowUp({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 14V4M5 8l4-4 4 4"/></svg>;
}

export function IconArrowDown({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 4v10M5 10l4 4 4-4"/></svg>;
}

export function IconClock({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/></svg>;
}

export function IconCamera({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><rect x="2" y="5" width="14" height="11" rx="1.5"/><circle cx="9" cy="11" r="3"/><path d="M6 5l1-2h4l1 2"/></svg>;
}

export function IconUpload({ size = 18, ...p }: IconProps) {
  return <svg {...base(size)} {...p}><path d="M9 12V4M5 8l4-4 4 4"/><path d="M3 14h12"/></svg>;
}

/* ── Компонент-диспетчер (для совместимости с существующим кодом) ── */

const ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  dashboard: IconDashboard,
  trips:     IconTrips,
  truck:     IconTruck,
  trucks:    IconTruck,
  drivers:   IconDrivers,
  finance:   IconFinance,
  finances:  IconFinance,
  expenses:  IconFinance,
  fuel:      IconFuel,
  repairs:   IconRepairs,
  reports:   IconReports,
  settings:  IconSettings,
  search:    IconSearch,
  bell:      IconBell,
  calendar:  IconCalendar,
  export:    IconExport,
  pin:       IconPin,
  menu:      IconMenu,
  close:     IconClose,
  chevron_down: IconChevronDown,
  chevron_right: IconChevronRight,
  check:     IconCheck,
  plus:      IconPlus,
  edit:      IconEdit,
  trash:     IconTrash,
  phone:     IconPhone,
  moon:      IconMoon,
  sun:       IconSun,
  logout:    IconLogout,
  warning:   IconWarning,
  dots:      IconDots,
  arrow_up:  IconArrowUp,
  arrow_down: IconArrowDown,
  clock:     IconClock,
  camera:    IconCamera,
  upload:    IconUpload,
};

export function DSIcon({ name, size = 18, ...p }: { name: string } & IconProps) {
  const Comp = ICONS[name.toLowerCase()];
  if (!Comp) return <span style={{ width: size, height: size, display: "inline-block" }} />;
  return <Comp size={size} {...p} />;
}
