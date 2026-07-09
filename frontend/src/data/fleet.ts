// Демо-данные парка для экрана «Панель» (Dashboard.tsx).
// Портировано из design_handoff_fleet_dashboard/reference/fleet-data.jsx.
// Статично до подключения реального API (см. задачу #55) — модель Truck в
// backend сейчас не содержит status/odometer/fuel%/"до ТО".
// "Автомобили" (Vehicles.tsx) переведена на настоящий CRUD над /api/trucks/
// 2026-06-23 — старые Vehicle/VehicleType и карточный VehicleCard.tsx
// убраны как мёртвый код (искусственные status/odo/fuel% не соответствовали
// реальной модели Truck).
export type VehicleStatus = "route" | "free" | "service";

export interface Driver {
  name: string;
  vehicle: string;
  status: VehicleStatus;
  rating: number;
  hours: number;
  trips: number;
}

export interface FleetData {
  fleetToday: { total: number; route: number; free: number; service: number };
  tripsWeek: { total: number; deltaPct: number; days: { d: string; v: number; hi?: boolean }[] };
  mileageWeek: number[];
  fuelWeek: { total: number; deltaPct: number; peakLabel: string; peakIdx: number; days: number[]; labels: string[] };
  live: { model: string; plate: string; region: string; driver: string; route: string; kmToday: number };
  structure: { name: string; count: number; color: string }[];
  footStats: { n: string; l: string }[];
  drivers: Driver[];
}

export const FLEET: FleetData = {
  fleetToday: { total: 24, route: 14, free: 7, service: 3 },

  tripsWeek: {
    total: 142,
    deltaPct: 12,
    days: [
      { d: "Пн", v: 22 },
      { d: "Вт", v: 26 },
      { d: "Ср", v: 19 },
      { d: "Чт", v: 24 },
      { d: "Пт", v: 31, hi: true },
      { d: "Сб", v: 12 },
      { d: "Вс", v: 8 },
    ],
  },

  mileageWeek: [142, 168, 151, 190, 176, 205, 198],

  fuelWeek: {
    total: 84200,
    deltaPct: -6,
    peakLabel: "₽14 600",
    peakIdx: 3,
    days: [9200, 12400, 10100, 14600, 11800, 13900, 12200],
    labels: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
  },

  live: {
    model: "MAN TGX 18.480",
    plate: "Е 482 КУ",
    region: "77",
    driver: "Соколов Д.",
    route: "Москва → Тверь",
    kmToday: 342,
  },

  structure: [
    { name: "Грузовые", count: 12, color: "var(--ink)" },
    { name: "Фургоны", count: 8, color: "var(--ink-3)" },
    { name: "Лёгкие", count: 4, color: "var(--accent)" },
  ],

  footStats: [
    { n: "18.4", l: "тыс. км / нед" },
    { n: "96%", l: "на ходу" },
    { n: "4", l: "ТО в июне" },
  ],

  drivers: [
    { name: "Соколов Дмитрий", vehicle: "MAN TGX 18.480", status: "route", rating: 5, hours: 38, trips: 24 },
    { name: "Орлов Павел", vehicle: "Volvo FH 460", status: "route", rating: 5, hours: 41, trips: 27 },
    { name: "Кузнецов Максим", vehicle: "КамАЗ 5490", status: "route", rating: 4, hours: 36, trips: 19 },
    { name: "Лебедев Игорь", vehicle: "Hyundai Solaris", status: "route", rating: 4, hours: 33, trips: 31 },
    { name: "Иванов Артём", vehicle: "Свободен", status: "free", rating: 5, hours: 0, trips: 0 },
    { name: "Петров Сергей", vehicle: "Свободен", status: "free", rating: 4, hours: 12, trips: 6 },
  ],
};
