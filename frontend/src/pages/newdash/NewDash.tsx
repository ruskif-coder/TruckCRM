/**
 * NewDash — рабочий стол логиста (/newdash), standalone (без AppShell).
 * Порт из design_handoff_fleet_crm/reference/desktop.html в React.
 * Стили — единый контур src/pages/newdash/newdash.css (скоуп `.nd`).
 *
 * ЭТАП 1 (текущий): полная оболочка + 6 виджетов + режим настройки
 * (перенос/ресайз/пресеты/сохранение) + панель рейса. Данные — демо из
 * хендоффа (точно под эталонный скриншот). Реальные API подключаются
 * повиджетно на следующем этапе — форма данных та же (см. константы ниже).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { api } from "../../api";
import { pct, type WeeklyData } from "../../lib/weekly";
import { lastNWeeksRange } from "../../components/DateRangePicker";
import { useAuth } from "../../auth/AuthContext";
import NdMenu from "./NdMenu";
import NdPhoneHead from "./NdPhoneHead";
import { shortDate, startDrag, useIsPhone } from "./shared";
import "./newdash.css";

// ────────────────────────────────────────────────────────────────────────────
// Данные (демо; форма совпадает с будущим ответом бэкенда)
// ────────────────────────────────────────────────────────────────────────────

type Kpi = { label: string; value: string; unit: string; delta: string; tone: "pos" | "neg" | ""; spark: number[]; peak: number };
const KPIS: Kpi[] = [
  { label: "Рейсы в неделю",  value: "24",   unit: "рейса",   delta: "+12%",        tone: "pos", spark: [.4, .55, .35, .7, .5, .85, 1],   peak: 6 },
  { label: "Машины в работе", value: "7",    unit: "из 9",    delta: "2 в ремонте", tone: "",    spark: [.7, .7, .55, .85, .7, .85, .78], peak: 3 },
  { label: "Выручка, млн ₽",  value: "1,84", unit: "нед. 32", delta: "+8%",         tone: "pos", spark: [.5, .62, .45, .6, .75, .9, 1],   peak: 6 },
  { label: "Простой",         value: "31",   unit: "часа",    delta: "+6 ч",        tone: "neg", spark: [.3, .25, .5, .4, .6, .8, .95],   peak: 6 },
];

type MetricKey = "trips" | "revenue" | "km";
// Переключатели графика — пиктограммы в слайдере. Реальные данные из trend.metrics.
const svgP = { width: 15, height: 15, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const METRIC_TABS: { key: MetricKey; title: string; icon: ReactNode }[] = [
  { key: "trips", title: "Рейсы", icon: <svg {...svgP}><circle cx="4" cy="12" r="1.6" /><circle cx="12" cy="4" r="1.6" /><path d="M4 10.4V8a3.5 3.5 0 0 1 3.5-3.5H10" /></svg> },
  { key: "revenue", title: "Выручка", icon: <svg {...svgP}><path d="M6 3.5h3a2.6 2.6 0 0 1 0 5.2H6" /><path d="M6 3.5v9" /><path d="M4 10h4.5" /></svg> },
  { key: "km", title: "Пробег", icon: <svg {...svgP}><path d="M2.5 12a5.5 5.5 0 1 1 11 0" /><path d="M8 12l3-2.5" /><circle cx="8" cy="12" r=".9" fill="currentColor" stroke="none" /></svg> },
];
const metricTitle: Record<MetricKey, string> = { trips: "Рейсы по неделям", revenue: "Выручка по неделям", km: "Пробег по неделям" };
const fmtMetric = (key: MetricKey, n: number): string =>
  key === "revenue" ? flowMoney(n) : key === "km" ? `${Math.round(n).toLocaleString("ru-RU")} км` : `${Math.round(n).toLocaleString("ru-RU")}`;

// ЗАГЛУШКА (демо). «Рейсы в работе» и «Табло рейсов» (BOARD ниже) остаются на
// демо-данных до появления API-доступа к OZON — без него живых рейсов нет.
type Tone = "ok" | "warn" | "risk" | "idle";
const TRIPS: [string, string, string, string, Tone, string][] = [
  ["Т221МК", "Минск → Вильнюс",  "Петров А.",   "В пути",   "ok",   "84 200"],
  ["К472ЕР", "Брест → Гомель",   "Сидоров И.",  "Погрузка", "warn", "41 500"],
  ["М108ТТ", "Витебск → Рига",   "Козлов Д.",   "Просрочка","risk", "96 800"],
  ["А904СН", "Могилёв → Минск",  "Ерёмин В.",   "Выгрузка", "ok",   "28 300"],
  ["В317РТ", "Гродно → Варшава", "Лукша П.",    "В пути",   "ok",   "112 000"],
  ["Е556КА", "Минск → Смоленск", "Не назначен", "Свободна", "idle", "52 400"],
];

type AlertTone = "crit" | "warn" | "ok";
type AlertItem = { tone: AlertTone; title: string; meta: string; when: string; route?: string };

// Ответ /api/foreman-dashboard/attention (admin/foreman). Форма — см. foreman_dashboard.py.
type AttentionData = {
  expiring_docs: { truck_id: number; plate: string; label: string; doc_type: string; expiry_date: string; days_left: number; critical: boolean }[];
  urgent_repairs: { id: number; driver_name: string; truck_label: string; text: string; priority: string; created_at: string }[];
  open_repairs_count: number;
  pending_comps_count: number;
};

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "сейчас";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} ${plural(d, "день", "дня", "дней")}`;
}

// Маппинг attention → лента алертов виджета
function mapAttention(d: AttentionData): AlertItem[] {
  const items: AlertItem[] = [];
  for (const doc of d.expiring_docs) {
    items.push({
      tone: doc.critical ? "crit" : "warn",
      title: `${doc.doc_type} ${doc.plate} ${doc.days_left < 0 ? "просрочен" : "истекает"}`,
      meta: doc.label && doc.label !== doc.plate ? doc.label : "документ ТС",
      when: doc.days_left < 0 ? "просрочен" : doc.days_left === 0 ? "сегодня" : `${doc.days_left} ${plural(doc.days_left, "день", "дня", "дней")}`,
      route: `/newdash/cars?plate=${encodeURIComponent(doc.plate)}`,
    });
  }
  for (const r of d.urgent_repairs) {
    items.push({
      tone: "crit",
      title: r.text.length > 46 ? r.text.slice(0, 44) + "…" : r.text,
      meta: [r.truck_label, r.driver_name].filter(x => x && x !== "—").join(" · ") || "срочный ремонт",
      when: relTime(r.created_at),
      route: "/newdash/repair",
    });
  }
  if (d.pending_comps_count > 0) {
    items.push({
      tone: "warn",
      title: `${d.pending_comps_count} ${plural(d.pending_comps_count, "заявка", "заявки", "заявок")} на компенсацию`,
      meta: "на рассмотрении",
      when: "",
      route: "/newdash/finance/claims",
    });
  }
  return items;
}

type BoarKind = "done" | "run" | "next";
type Bar = [number, number, string, string, BoarKind];

// Демо-данные табло на ±24 ч от «сейчас». Генерируются детерминированно
// (без Math.random — стабильно между рендерами): у каждого водителя цепочка
// рейсов с простоями, покрывающая окно [NOW-24 … NOW+24].
// Геометрия времени табло. «Сейчас» фиксировано (демо). Окно (SPAN) 9/12/18/24,
// линия «сейчас» ВСЕГДА на 1/3: треть до, две трети после → start = NOW − SPAN/3.
const NOW = 22.02;
const NOW_FRAC = 1 / 3;                       // доля окна до линии «сейчас»
const boardStart = (span: number) => NOW - span * NOW_FRAC;
const SPAN_OPTIONS = [9, 12, 18, 24];
const DRIVERS: [string, string][] = [
  ["Нагарев", "Т221МК"], ["Кочетов", "К472ЕР"], ["Королёв", "М108ТТ"], ["Жбанков", "А904СН"],
  ["Мартынов", "В317РТ"], ["Хромых", "Е556КА"], ["Цепков", "Н742ВК"], ["Кислов", "О695РМ"],
];
const HUBS = ["Пушкино_1_РФЦ", "Пушкино_2_РФЦ", "Хаб_Промышленная", "Ногинск_РФЦ", "Ватутинки_РФЦ", "Домодедово_Хаб", "Истра_ДО", "Петровское_РФЦ", "Жуковский_Хаб", "Солнечногорск_КГТ", "Осташковский_3_Хаб", "Купавна"];
function genBars(seed: number): Bar[] {
  const bars: Bar[] = [];
  let t = NOW - 24 + (seed % 3) * 0.6;      // фаза старта чуть разная у водителей
  let idx = seed * 5;
  while (t < NOW + 24) {
    const dur = 2.2 + ((idx * 7) % 5) * 0.34;   // 2.2 … 3.6 ч
    const from = Math.max(t, NOW - 24);
    const to = Math.min(t + dur, NOW + 24);
    if (to - from > 0.25) {
      const kind: BoarKind = to <= NOW ? "done" : from < NOW ? "run" : "next";
      const a = HUBS[idx % HUBS.length], b = HUBS[(idx * 3 + 1) % HUBS.length];
      const route = `${a} → ${b === a ? HUBS[(idx + 4) % HUBS.length] : b}`;
      const order = "№" + (6100000 + seed * 1300 + idx * 17);
      bars.push([from, to, route, order, kind]);
    }
    const gap = 0.4 + ((idx * 3) % 4) * 0.35;   // 0.4 … 1.45 ч простой
    t = to + gap;
    idx++;
  }
  return bars;
}
const BOARD: [string, string, Bar[]][] = DRIVERS.map(([d, p], i) => [d, p, genBars(i + 1)]);

const EXTRAS: Record<string, { km: number; cargo: string; weight: string; sum: string; gate: string; temp: string }> = {
  "№6253313": { km: 84,  cargo: "Паллеты · 12 мест",       weight: "9,4 т",  sum: "84 200 ₽",  gate: "Ворота 14", temp: "без режима" },
  "№6170412": { km: 46,  cargo: "Возвратная тара",         weight: "2,1 т",  sum: "18 400 ₽",  gate: "Ворота 3",  temp: "без режима" },
  "№6170509": { km: 92,  cargo: "Сборный груз · 31 место", weight: "11,8 т", sum: "96 800 ₽",  gate: "Ворота 7",  temp: "без режима" },
  "№6129017": { km: 58,  cargo: "Возвраты · 18 мест",      weight: "4,6 т",  sum: "41 500 ₽",  gate: "Ворота 2",  temp: "без режима" },
  "№6129340": { km: 104, cargo: "Паллеты · 16 мест",       weight: "12,2 т", sum: "112 000 ₽", gate: "Ворота 9",  temp: "+2…+6 °C" },
  "№6170208": { km: 37,  cargo: "Паллеты · 8 мест",        weight: "5,3 т",  sum: "28 300 ₽",  gate: "Ворота 5",  temp: "без режима" },
  "№6170331": { km: 37,  cargo: "Возвратная тара",         weight: "1,8 т",  sum: "24 900 ₽",  gate: "Ворота 5",  temp: "без режима" },
  "№6253301": { km: 61,  cargo: "Паллеты · 10 мест",       weight: "7,9 т",  sum: "52 400 ₽",  gate: "Ворота 12", temp: "без режима" },
  "№6129605": { km: 22,  cargo: "Межскладской · 24 места", weight: "8,1 т",  sum: "19 700 ₽",  gate: "Ворота 1",  temp: "без режима" },
  "№6231588": { km: 78,  cargo: "Сборный груз · 27 мест",  weight: "10,6 т", sum: "74 300 ₽",  gate: "Ворота 8",  temp: "+2…+6 °C" },
  "№6314053": { km: 66,  cargo: "Паллеты · 14 мест",       weight: "9,0 т",  sum: "63 100 ₽",  gate: "Ворота 6",  temp: "без режима" },
  "№6252989": { km: 88,  cargo: "КГТ · 5 мест",            weight: "6,4 т",  sum: "81 500 ₽",  gate: "Ворота 11", temp: "без режима" },
  "№6231044": { km: 54,  cargo: "Сборный груз · 22 места", weight: "7,2 т",  sum: "46 900 ₽",  gate: "Ворота 4",  temp: "без режима" },
};

// Каждый KPI-показатель — отдельный виджет (перенос/ресайз/скрытие независимо).
// «Денежный поток» — из GET /api/dashboard/ (см. Dashboard.tsx)
type CashflowData = { income: number; expense: number; net: number; by_category: { category: string; value: number }[]; carrier_receivable?: number };
const flowMoney = (n: number) => Math.round(n).toLocaleString("ru-RU") + " ₽";
// «Расчёт по неделям» (виджет-таблица как в Отчётах) — GET /api/dashboard/weekly
// Палитра под сайт: поступления — фирменный лайм (--accent), расходы —
// тёплая олива/охра/терракота/тауп в тон нейтралям темы (без «радуги»).
const INCOME_COLOR = "var(--accent)";
const FLOW_COLORS = ["#B7C24E", "#DFC167", "#CE9F5E", "#C67E5C", "#B08E6A", "#8FA06B", "#9C9A78", "#B58C74"];

// Динамика по неделям (график) + топливо — из GET /api/dashboard/ (trend).
type TrendMetric = { values: number[]; labels: string[]; unit: string; total: number; peak_idx: number };
type FuelTrend = { days: number[]; volumes: number[]; labels: string[]; peak_idx: number; peak_label: string; total: number };
type DashTrend = { metrics: Record<"trips" | "revenue" | "km", TrendMetric>; fuel: FuelTrend };

// KPI-плитка из недельного ряда: значение последней недели + дельта к прошлой + спарклайн.
function trendKpi(m: TrendMetric | undefined, label: string, kind: "count" | "million"): Kpi {
  if (!m || m.values.length < 2) return { label, value: "…", unit: "", delta: "", tone: "", spark: [0, 0, 0, 0, 0, 0, 0, 0], peak: 7 };
  const vals = m.values;
  const last = vals[vals.length - 1], prev = vals[vals.length - 2];
  const max = Math.max(1, ...vals);
  const spark = vals.map(v => v / max);
  const peak = vals.indexOf(Math.max(...vals));
  const d = last - prev;
  const sign = d >= 0 ? "+" : "−";
  const delta = prev > 0 ? `${sign}${Math.abs((d / prev) * 100).toFixed(0)}%` : `${sign}${Math.round(Math.abs(d)).toLocaleString("ru-RU")}`;
  const value = kind === "million" ? (last / 1e6).toFixed(2).replace(".", ",") : Math.round(last).toLocaleString("ru-RU");
  const unit = kind === "million" ? "млн ₽/нед" : "за неделю";
  return { label, value, unit, delta, tone: d >= 0 ? "pos" : "neg", spark, peak };
}

type WKey = "main" | "kpiTrips" | "kpiCars" | "kpiRevenue" | "kpiIdle" | "chart" | "fuel" | "cashflow" | "weekly" | "trips" | "alerts";

const WIDGET_NAMES: Record<WKey, string> = {
  main: "Табло рейсов (главный)",
  kpiTrips: "Показатель: Рейсы в неделю",
  kpiCars: "Показатель: Машины в работе",
  kpiRevenue: "Показатель: Выручка",
  kpiIdle: "Показатель: Простой",
  chart: "График динамики",
  fuel: "Топливо за неделю", cashflow: "Денежный поток", weekly: "Расчёт по неделям", trips: "Рейсы в работе", alerts: "Требует внимания",
};

type Layout = { vis: Record<WKey, number>; w: Record<WKey, number>; h: Partial<Record<WKey, number>>; order: WKey[] };

// vis/w в пресетах ЗАМЕНЯЮТ текущие целиком (applyPreset) — перечислять ВСЕ ключи.
const KPI_VIS = (v: number) => ({ kpiTrips: v, kpiCars: v, kpiRevenue: v, kpiIdle: v });
const KPI_W3 = { kpiTrips: 3, kpiCars: 3, kpiRevenue: 3, kpiIdle: 3 };
const PRESETS: Record<string, Pick<Layout, "vis" | "w">> = {
  dispatch:  { vis: { main: 1, ...KPI_VIS(0), chart: 0, fuel: 1, cashflow: 1, weekly: 0, trips: 1, alerts: 1 }, w: { main: 12, ...KPI_W3, chart: 8, fuel: 4, cashflow: 4, weekly: 12, trips: 8, alerts: 4 } },
  analytics: { vis: { main: 0, ...KPI_VIS(1), chart: 1, fuel: 0, cashflow: 1, weekly: 1, trips: 0, alerts: 1 }, w: { main: 12, ...KPI_W3, chart: 8, fuel: 4, cashflow: 4, weekly: 12, trips: 7, alerts: 4 } },
  all:       { vis: { main: 1, ...KPI_VIS(1), chart: 1, fuel: 1, cashflow: 1, weekly: 1, trips: 1, alerts: 1 }, w: { main: 12, ...KPI_W3, chart: 8, fuel: 4, cashflow: 4, weekly: 12, trips: 7, alerts: 5 } },
};

const GAP = 14, COLS = 12, LS_KEY = "fleet.desk.layout.v2";
const DEFAULT_LAYOUT: Layout = {
  vis: { main: 1, ...KPI_VIS(1), chart: 1, fuel: 1, cashflow: 1, weekly: 1, trips: 1, alerts: 1 },
  w:   { main: 12, ...KPI_W3, chart: 8, fuel: 4, cashflow: 4, weekly: 12, trips: 7, alerts: 5 },
  h:   {},
  order: ["main", "kpiTrips", "kpiCars", "kpiRevenue", "kpiIdle", "chart", "fuel", "cashflow", "weekly", "trips", "alerts"],
};

const hhmm = (h: number) => {
  const t = ((h % 24) + 24) % 24;
  return String(Math.floor(t)).padStart(2, "0") + ":" + String(Math.round((t % 1) * 60)).padStart(2, "0");
};

const PREF_KEY = "desk.layout";  // ключ на бэкенде: GET/PUT /api/user-prefs/desk.layout

// Глубокий мёрж сохранённой раскладки с дефолтом (новые ключи/дефолты vis/w/h
// не теряются). null/битое/несовпадающий order → дефолт. Общий для localStorage
// и серверного значения (/api/user-prefs).
function mergeLayout(saved: unknown): Layout {
  const s = saved as Partial<Layout> | null;
  if (s && s.order && s.order.length === DEFAULT_LAYOUT.order.length) {
    return {
      ...DEFAULT_LAYOUT, ...s,
      vis: { ...DEFAULT_LAYOUT.vis, ...s.vis },
      w: { ...DEFAULT_LAYOUT.w, ...s.w },
      h: { ...DEFAULT_LAYOUT.h, ...s.h },
    };
  }
  return DEFAULT_LAYOUT;
}

function loadLayout(): Layout {
  try { return mergeLayout(JSON.parse(localStorage.getItem(LS_KEY) || "null")); }
  catch { return DEFAULT_LAYOUT; }
}

// ────────────────────────────────────────────────────────────────────────────
// Открытый рейс (для панели)
// ────────────────────────────────────────────────────────────────────────────
type OpenTrip = { id: string; route: string; order: string; driver: string; plate: string; from: number; to: number; kind: BoarKind };
type Comment = { author: string; when: string; text: string };


// ════════════════════════════════════════════════════════════════════════════
export default function NewDash() {
  const { user } = useAuth();

  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const [metric, setMetric] = useState<MetricKey>("trips");
  const [boardSpan, setBoardSpan] = useState(9);    // окно табло: 9/12/18/24 ч

  const [editing, setEditing] = useState(false);
  const [L, setL] = useState<Layout>(loadLayout);
  const [dragging, setDragging] = useState<WKey | null>(null);
  const Lref = useRef(L);
  // Раскладка стола сохраняется ЗА ПОЛЬЗОВАТЕЛЕМ на бэкенде (/api/user-prefs),
  // а не только в localStorage — переживает чистку кеша и смену устройства.
  // localStorage остаётся мгновенным кешем (рендер до ответа сервера).
  const prefLoaded = useRef(false);   // серверное значение уже применено
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 1) при входе тянем серверную раскладку и, если есть, применяем поверх кеша.
  useEffect(() => {
    let alive = true;
    api.get<{ value: unknown }>(`/api/user-prefs/${PREF_KEY}`)
      .then(r => { if (alive && r.value) setL(mergeLayout(r.value)); })
      .catch(() => { /* нет доступа/сети → остаёмся на localStorage-кеше */ })
      .finally(() => { if (alive) prefLoaded.current = true; });
    return () => { alive = false; };
  }, []);
  // 2) на изменение — мгновенно в localStorage + дебаунс-сохранение на сервер
  //    (только после первичной загрузки, чтобы не затереть серверное дефолтом).
  useEffect(() => {
    Lref.current = L;
    try { localStorage.setItem(LS_KEY, JSON.stringify(L)); } catch { /* ignore */ }
    if (!prefLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.put(`/api/user-prefs/${PREF_KEY}`, { value: L }).catch(() => { /* сеть/доступ — не критично */ });
    }, 600);
  }, [L]);

  // панель рейса
  const [openTrip, setOpenTrip] = useState<OpenTrip | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [draft, setDraft] = useState("");

  // Реальные данные: «Требует внимания» (null = загрузка)
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<AttentionData>("/api/foreman-dashboard/attention")
      .then(d => { if (alive) setAlerts(mapAttention(d)); })
      .catch(() => { if (alive) setAlerts([]); });   // нет доступа/ошибка → пустая лента
    return () => { alive = false; };
  }, []);

  // Реальные данные из /api/dashboard/: «Денежный поток» + тренд (график
  // динамики по неделям) + топливо. Без явного периода — бэкенд берёт единое
  // якорное окно 8 недель (как у графика), чтобы весь дашборд был за один период.
  const [cashflow, setCashflow] = useState<CashflowData | null>(null);
  const [trend, setTrend] = useState<DashTrend | null>(null);
  useEffect(() => {
    let alive = true;
    api.get<{ cashflow: CashflowData; trend: DashTrend }>(`/api/dashboard/`)
      .then(d => { if (alive) { setCashflow(d.cashflow); setTrend(d.trend); } })
      .catch(() => { if (alive) { setCashflow({ income: 0, expense: 0, net: 0, by_category: [] }); setTrend(null); } });
    return () => { alive = false; };
  }, []);

  // Реальные данные: «Расчёт по неделям» — по умолчанию последние 8 недель
  const [weekly, setWeekly] = useState<WeeklyData | null>(null);
  useEffect(() => {
    let alive = true;
    const { dateFrom, dateTo } = lastNWeeksRange(8);
    api.get<WeeklyData>(`/api/dashboard/weekly?date_from=${dateFrom}&date_to=${dateTo}`)
      .then(d => { if (alive) setWeekly(d); })
      .catch(() => { if (alive) setWeekly({ period: { date_from: "", date_to: "" }, weeks: [], notes: [] }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenTrip(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Мозаичная упаковка: каждому виджету считаем row-span по его реальной
  //    высоте, чтобы высокий блок занимал несколько строк, а рядом (dense)
  //    вставали два малых друг под другом. ROW_H+GAP = «единица высоты». ──
  const workRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = workRef.current; if (!el) return;
    const ROW_H = 8, UNIT = ROW_H + GAP;   // GAP = row-gap сетки
    const compute = () => {
      for (const child of Array.from(el.children) as HTMLElement[]) {
        if (!child.dataset.wkey) continue;
        if (getComputedStyle(child).display === "none") { child.style.gridRowEnd = ""; continue; }
        const h = child.getBoundingClientRect().height;
        const span = Math.max(1, Math.ceil((h + GAP) / UNIT));
        const val = `span ${span}`;
        if (child.style.gridRowEnd !== val) child.style.gridRowEnd = val;
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    window.addEventListener("resize", compute);
    return () => { ro.disconnect(); window.removeEventListener("resize", compute); };
  }, [L, alerts, cashflow, editing, dragging]);

  const nameStr = user?.full_name || user?.username || "Логист";
  const initials = nameStr.trim() ? nameStr.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() : "Л";

  // ── стиль виджета из раскладки ──
  const wStyle = (key: WKey): React.CSSProperties => ({
    gridColumn: `span ${L.w[key]}`,
    order: L.order.indexOf(key),
    // «Расчёт по неделям» всегда по высоте контента — все строки без вертикального
    // скролла (фикс-высоту/ресайз для него игнорируем).
    ...(L.h[key] && key !== "weekly" ? { height: L.h[key], overflow: "hidden" } : {}),
    display: L.vis[key] ? undefined : "none",
  });

  // ── редактор ──
  function nodeOf(e: React.MouseEvent): HTMLElement | null {
    return (e.currentTarget as HTMLElement).closest("[data-wkey]") as HTMLElement | null;
  }
  function onDragStart(e: React.MouseEvent, key: WKey) {
    e.preventDefault();
    setDragging(key);
    startDrag(ev => {
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const host = under && (under as HTMLElement).closest ? (under as HTMLElement).closest("[data-wkey]") : null;
      const target = host?.getAttribute("data-wkey") as WKey | undefined;
      if (!target || target === key) return;
      setL(prev => {
        const o = [...prev.order];
        const a = o.indexOf(key), b = o.indexOf(target);
        if (a < 0 || b < 0) return prev;
        o.splice(b, 0, o.splice(a, 1)[0]);
        return { ...prev, order: o };
      });
    }, () => setDragging(null));
  }
  function onResizeX(e: React.MouseEvent, key: WKey) {
    e.preventDefault(); e.stopPropagation();
    const node = nodeOf(e); if (!node) return;
    const box = node.getBoundingClientRect();
    const startW = box.width, startX = e.clientX;
    const unit = (box.width + GAP) / Lref.current.w[key];
    startDrag(ev => {
      const n = Math.max(3, Math.min(COLS, Math.round((startW + (ev.clientX - startX) + GAP) / unit)));
      setL(prev => (prev.w[key] === n ? prev : { ...prev, w: { ...prev.w, [key]: n } }));
    });
  }
  function onResizeY(e: React.MouseEvent, key: WKey) {
    e.preventDefault(); e.stopPropagation();
    const node = nodeOf(e); if (!node) return;
    const startY = e.clientY, startH = node.getBoundingClientRect().height;
    startDrag(ev => {
      const h = Math.max(180, Math.min(620, Math.round(startH + (ev.clientY - startY))));
      setL(prev => ({ ...prev, h: { ...prev.h, [key]: h } }));
    });
  }
  const removeWidget = (key: WKey) => setL(prev => ({ ...prev, vis: { ...prev.vis, [key]: 0 } }));
  const addWidget    = (key: WKey) => setL(prev => ({ ...prev, vis: { ...prev.vis, [key]: 1 } }));
  const applyPreset  = (name: string) => setL(prev => ({ ...prev, vis: { ...PRESETS[name].vis }, w: { ...PRESETS[name].w }, h: {} }));

  const hiddenKeys = L.order.filter(k => !L.vis[k]);

  // ── панель рейса: комментарии ──
  function addComment() {
    const text = draft.trim();
    if (!text || !openTrip) return;
    const n = new Date();
    const when = String(n.getHours()).padStart(2, "0") + ":" + String(n.getMinutes()).padStart(2, "0");
    setComments(prev => ({ ...prev, [openTrip.id]: [...(prev[openTrip.id] || []), { author: "Ирина К.", when, text }] }));
    setDraft("");
  }

  // ── оснастка виджета (ручки) ──
  const rig = (key: WKey, withY = true, xStyle?: React.CSSProperties) => (
    <>
      <div className="w-handle" onMouseDown={e => onDragStart(e, key)}>⠿ ПЕРЕНЕСТИ</div>
      <button className="w-remove" title="Убрать со стола" onClick={() => removeWidget(key)}>×</button>
      <button className="w-resize-x" title="Ширина" style={xStyle} onMouseDown={e => onResizeX(e, key)} />
      {withY && <button className="w-resize-y" title="Высота" onMouseDown={e => onResizeY(e, key)} />}
    </>
  );

  // ── один KPI-показатель как самостоятельный виджет ──
  const renderKpi = (key: WKey, k: Kpi, demo = false): ReactNode => (
    <section key={key} className="widget kpi" data-wkey={key} data-dragging={dragging === key || undefined} style={wStyle(key)}>
      {rig(key, false)}
      <div className="kpi__top">
        <span className="t-mono-label">{k.label}{demo && <span className="kpi__demo">демо</span>}</span>
        <span className={`t-caption ${k.tone}`} style={{ fontWeight: 600 }}>{k.delta}</span>
      </div>
      <div className="kpi__value"><span className="t-num-l">{k.value}</span><span className="kpi__unit">{k.unit}</span></div>
      <div className="spark">
        {k.spark.map((v, i) => <i key={i} className={i === k.peak ? "is-peak" : ""} style={{ height: `${Math.round(v * 100)}%` }} />)}
      </div>
      {demo && <div className="kpi__demo-note t-caption muted">Демо данные</div>}
    </section>
  );

  // ── рендер виджетов (стабильный DOM-порядок, визуальный — через order) ──
  const widgets: Record<WKey, ReactNode> = {
    main: (
      <section key="main" className="widget" data-wkey="main" data-dragging={dragging === "main" || undefined} style={wStyle("main")}>
        {rig("main")}
        <div className="widget__head wrap">
          <div className="row-c gap-14 wrap">
            <span className="t-h2">Табло рейсов</span>
            <span className="t-mono-500" style={{ fontSize: 15 }}>{hhmm(NOW)}</span>
            <span className="segments segments--flush">
              {SPAN_OPTIONS.map(s => (
                <button key={s} className="segments__item" aria-selected={boardSpan === s} onClick={() => setBoardSpan(s)}>{s} ч</button>
              ))}
            </span>
            <span className="t-mono muted">сегодня</span>
          </div>
          <div className="board-legend t-caption muted-2">
            <span><i className="swatch swatch--done" />завершён</span>
            <span><i className="swatch swatch--run" />в пути</span>
            <span><i className="swatch swatch--next" />предстоит</span>
          </div>
        </div>
        <Board onOpen={setOpenTrip} span={boardSpan} />
      </section>
    ),
    kpiTrips:   renderKpi("kpiTrips", trendKpi(trend?.metrics.trips, "Рейсы в неделю", "count")),
    kpiCars:    renderKpi("kpiCars", KPIS[1], true),
    kpiRevenue: renderKpi("kpiRevenue", trendKpi(trend?.metrics.revenue, "Выручка", "million")),
    kpiIdle:    renderKpi("kpiIdle", KPIS[3], true),
    chart: (() => {
      const met = trend?.metrics[metric];
      const values = met?.values ?? [];
      const labels = met?.labels ?? [];
      const last = values.length - 1;
      const delta = values.length >= 2 ? values[last] - values[last - 1] : 0;
      return (
        <section key="chart" className="widget" data-wkey="chart" data-dragging={dragging === "chart" || undefined} style={wStyle("chart")}>
          {rig("chart")}
          {/* Тумблеры — отдельной строкой сверху; заголовок и число под ними на всю ширину */}
          <div className="row-c" style={{ justifyContent: "flex-end", marginBottom: 6 }}>
            <div className="segments segments--flush chart-metrics">
              {METRIC_TABS.map(mt => (
                <button key={mt.key} className="segments__item" aria-selected={metric === mt.key} title={mt.title} onClick={() => setMetric(mt.key)}>{mt.icon}</button>
              ))}
            </div>
          </div>
          <div className="t-h2">{metricTitle[metric]}</div>
          <div className="metric-total" style={{ flexWrap: "wrap", columnGap: 14, rowGap: 2 }}>
            <span className="t-display" style={{ fontSize: 40, lineHeight: 1, whiteSpace: "nowrap" }}>{trend === null ? "…" : fmtMetric(metric, met?.total ?? 0)}</span>
            {met && values.length >= 2 && (
              <span className="metric-total__delta" style={{ flexDirection: "column", alignItems: "flex-start", gap: 0, paddingBottom: 4 }}>
                <span className={"t-body " + (delta >= 0 ? "pos" : "neg")} style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{delta >= 0 ? "+" : "−"}{fmtMetric(metric, Math.abs(delta))}</span>
                <span className="t-caption muted" style={{ lineHeight: 1.2 }}>к прошлой неделе</span>
              </span>
            )}
          </div>
          {trend === null ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "40px 2px" }}>Загрузка…</div>
          ) : values.every(v => v === 0) ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "40px 2px" }}>Нет данных за период</div>
          ) : (
            <ChartView values={values} labels={labels} peak={met?.peak_idx ?? 0} />
          )}
        </section>
      );
    })(),
    fuel: (() => {
      const f = trend?.fuel;
      const liters = f ? Math.round(f.volumes.reduce((s, x) => s + x, 0)) : 0;
      const weeks = f?.days.length ?? 0;
      const nf = (n: number) => n.toLocaleString("ru-RU");
      const li = f ? f.days.length - 1 : -1;                 // индекс последней недели
      const lastMoney = f && li >= 0 ? f.days[li] : 0;
      const lastVol = f && li >= 0 ? Math.round(f.volumes[li]) : 0;
      const lastLabel = f && li >= 0 ? f.labels[li] : "";
      return (
        <section key="fuel" className="widget" data-wkey="fuel" data-dragging={dragging === "fuel" || undefined} style={wStyle("fuel")}>
          {rig("fuel", false)}
          <div className="t-h2" style={{ marginBottom: 16 }}>Топливо{weeks ? ` · ${weeks} нед.` : ""}</div>
          {trend === null ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "24px 2px" }}>Загрузка…</div>
          ) : !f || (f.total === 0 && liters === 0) ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "24px 2px" }}>Нет заправок за период</div>
          ) : (
            <>
              <div className="fuel-cols">
                <div className="fuel-col">
                  <div className="fuel-col__cap">За 8 недель{weeks ? ` (${weeks})` : ""}</div>
                  <div className="fuel-col__money">{flowMoney(f.total)}</div>
                  <div className="fuel-col__vol">{nf(liters)} л{weeks ? <span className="muted"> · {nf(Math.round(liters / weeks))} л/нед</span> : null}</div>
                </div>
                <div className="fuel-col">
                  <div className="fuel-col__cap">Последняя неделя{lastLabel ? ` · ${lastLabel}` : ""}</div>
                  <div className="fuel-col__money">{flowMoney(lastMoney)}</div>
                  <div className="fuel-col__vol">{nf(lastVol)} л</div>
                </div>
              </div>
              <div className="fuel-legend__foot" style={{ marginTop: 12 }}><span className="t-body-s muted">Пик — {f.labels[f.peak_idx]}</span><span className="t-body-s num" style={{ fontWeight: 600 }}>{f.peak_label}</span></div>
            </>
          )}
        </section>
      );
    })(),
    cashflow: (() => {
      const income = cashflow?.income ?? 0;
      const expense = cashflow?.expense ?? 0;
      const receivable = cashflow?.carrier_receivable ?? 0;   // ожидаемые деньги (долг перевозчиков)
      const expSegs = cashflow ? cashflow.by_category.filter(c => c.value > 0).map((c, i) => ({ name: c.category, value: c.value, color: FLOW_COLORS[i % FLOW_COLORS.length] })) : [];
      const maxv = Math.max(income + receivable, expense, 1);   // общая шкала (поступления с ожидаемым vs списания)
      const netFact = cashflow ? cashflow.net : 0;              // факт: получено − списано
      const netForecast = netFact + receivable;                 // прогноз: + ожидаемые
      const empty = cashflow && income === 0 && expense === 0 && receivable === 0;
      return (
        <section key="cashflow" className="widget" data-wkey="cashflow" data-dragging={dragging === "cashflow" || undefined} style={wStyle("cashflow")}>
          {rig("cashflow", false)}
          <div className="widget__head" style={{ marginBottom: 14 }}>
            <span className="t-h2">Денежный поток</span>
            <span className="t-mono muted">за 8 недель</span>
          </div>
          {cashflow === null ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 2px" }}>Загрузка…</div>
          ) : empty ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 2px" }}>Нет операций по денежному потоку за период</div>
          ) : (
            <>
              <div className="flow-dir">
                <div className="flow-dir__head"><span className="t-body-s">Поступления{receivable > 0 ? " (факт + ожид.)" : ""}</span><span className="t-body-s num" style={{ fontWeight: 600, color: "var(--success-strong)" }}>{flowMoney(income)}{receivable > 0 ? <span className="muted"> +{flowMoney(receivable)}</span> : null}</span></div>
                <div className="flow-bar">
                  <div className="flow-bar__seg" style={{ width: `${(income / maxv) * 100}%`, background: INCOME_COLOR }} title={`Получено: ${flowMoney(income)}`} />
                  {receivable > 0 && <div className="flow-bar__seg flow-bar__seg--expected" style={{ width: `${(receivable / maxv) * 100}%` }} title={`Ожидается (долг перевозчиков): ${flowMoney(receivable)}`} />}
                </div>
              </div>
              <div className="flow-dir">
                <div className="flow-dir__head"><span className="t-body-s">Списания</span><span className="t-body-s num" style={{ fontWeight: 600, color: "var(--danger)" }}>{flowMoney(expense)}</span></div>
                <div className="flow-bar">
                  {expSegs.map((s, i) => (
                    <div key={i} className="flow-bar__seg" style={{ width: `${(s.value / maxv) * 100}%`, background: s.color }} title={`${s.name}: ${flowMoney(s.value)}`} />
                  ))}
                </div>
              </div>
              <div className="fuel-legend">
                {receivable > 0 && (
                  <div className="fuel-legend__row">
                    <i className="swatch swatch--expected" />
                    <span className="t-body-s grow ellip">Ожидается (долг перевозчиков)</span>
                    <span className="t-body-s num" style={{ fontWeight: 600 }}>{flowMoney(receivable)}</span>
                  </div>
                )}
                {expSegs.map((s, i) => (
                  <div className="fuel-legend__row" key={i}>
                    <i className="swatch" style={{ background: s.color }} />
                    <span className="t-body-s grow ellip">{s.name}</span>
                    <span className="t-body-s num" style={{ fontWeight: 600 }}>{flowMoney(s.value)}</span>
                  </div>
                ))}
                <div className="fuel-legend__foot">
                  <span className="t-body-s muted">Сальдо · факт / прогноз</span>
                  <span className="t-body-s num" style={{ fontWeight: 700 }}>
                    <span style={{ color: netFact >= 0 ? "var(--success-strong)" : "var(--danger)" }}>{flowMoney(netFact)}</span>
                    <span className="muted"> / </span>
                    <span style={{ color: netForecast >= 0 ? "var(--success-strong)" : "var(--danger)" }}>{flowMoney(netForecast)}</span>
                  </span>
                </div>
              </div>
            </>
          )}
        </section>
      );
    })(),
    weekly: (() => {
      const rows = weekly ? weekly.weeks.flatMap(w => w.rows.map((r, i) => ({ ...r, week_start: w.week_start, week_end: w.week_end, _k: `${w.week_start}-${r.truck_id}-${r.driver_id}-${i}` }))) : [];
      const grand = weekly ? weekly.weeks.reduce((a, w) => ({ trips: a.trips + w.totals.trips, gross: a.gross + w.totals.gross, net: a.net + w.totals.net, fuel: a.fuel + w.totals.fuel, driver_payout: a.driver_payout + w.totals.driver_payout, profit: a.profit + w.totals.profit }), { trips: 0, gross: 0, net: 0, fuel: 0, driver_payout: 0, profit: 0 }) : null;
      const grandRent = grand && grand.net ? grand.profit / grand.net : null;
      const cols = "132px minmax(120px,1.3fr) 108px minmax(120px,1.3fr) 62px 96px 96px 96px 110px 96px 70px";
      return (
        <section key="weekly" className="widget rpt-table" data-wkey="weekly" data-dragging={dragging === "weekly" || undefined} style={wStyle("weekly")}>
          {rig("weekly")}
          <div className="widget__head" style={{ marginBottom: 12 }}>
            <span className="t-h2">Расчёт по неделям</span>
            {weekly && weekly.period.date_from && <span className="t-mono muted">{shortDate(weekly.period.date_from)} – {shortDate(weekly.period.date_to)}</span>}
          </div>
          {weekly === null ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 2px" }}>Загрузка…</div>
          ) : rows.length === 0 ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 2px" }}>Нет рейсов за период</div>
          ) : (
            <div className="table-card">
              <div className="table-scroll" style={{ flex: "1 1 auto", minHeight: 0 }}>
                <div className="table" data-density="compact" style={{ gridTemplateColumns: cols }}>
                  <div className="table__head">
                    {["Период", "Перевозчик", "Машина", "Водитель"].map(h => <div className="table__th" key={h}>{h}</div>)}
                    {["Рейсов", "Выручка", "Netto", "Топливо", "Выплата вод.", "Прибыль", "Рентаб."].map(h => <div className="table__th" key={h} style={{ justifyContent: "flex-end" }}>{h}</div>)}
                  </div>
                  {rows.map(r => (
                    <div className="table__row" key={r._k}>
                      <div className="table__td table__td--mono">{shortDate(r.week_start)} – {shortDate(r.week_end)}</div>
                      <div className="table__td">{r.carrier_name || "—"}</div>
                      <div className="table__td">{r.truck_label}</div>
                      <div className="table__td">{r.driver_label}</div>
                      <div className="table__td table__td--num">{r.trips}</div>
                      <div className="table__td table__td--num">{flowMoney(r.gross)}</div>
                      <div className="table__td table__td--num">{flowMoney(r.net)}</div>
                      <div className="table__td table__td--num">{flowMoney(r.fuel)}</div>
                      <div className="table__td table__td--num">{flowMoney(r.driver_payout)}</div>
                      <div className="table__td table__td--num" style={{ color: r.profit >= 0 ? "var(--success-strong)" : "var(--danger)", fontWeight: 600 }}>{flowMoney(r.profit)}</div>
                      <div className="table__td table__td--num">{pct(r.profitability)}</div>
                    </div>
                  ))}
                  {grand && (
                    <div className="table__foot">
                      <div className="table__td">Итого · {rows.length}</div>
                      <div className="table__td" /><div className="table__td" /><div className="table__td" />
                      <div className="table__td table__td--num">{grand.trips}</div>
                      <div className="table__td table__td--num">{flowMoney(grand.gross)}</div>
                      <div className="table__td table__td--num">{flowMoney(grand.net)}</div>
                      <div className="table__td table__td--num">{flowMoney(grand.fuel)}</div>
                      <div className="table__td table__td--num">{flowMoney(grand.driver_payout)}</div>
                      <div className="table__td table__td--num">{flowMoney(grand.profit)}</div>
                      <div className="table__td table__td--num">{pct(grandRent)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      );
    })(),
    trips: (
      <section key="trips" className="widget" data-wkey="trips" data-dragging={dragging === "trips" || undefined} style={{ ...wStyle("trips"), paddingBottom: 8 }}>
        {rig("trips")}
        <div className="widget__head">
          <span className="t-h2">Рейсы в работе</span>
          <div className="row-c gap-10">
            <span className="t-mono muted">7 из 9 машин</span>
            <button className="btn btn--soft">Все рейсы</button>
          </div>
        </div>
        <div className="flatlist__head">
          <span className="t-mono-label">Машина</span><span className="t-mono-label">Маршрут</span>
          <span className="t-mono-label">Водитель</span><span className="t-mono-label">Статус</span>
          <span className="t-mono-label" style={{ textAlign: "right" }}>Сумма</span>
        </div>
        {TRIPS.map(([plate, route, driver, status, tone, sum], i) => (
          <div className="flatlist__row" key={i}>
            <span className="t-mono-500">{plate}</span>
            <span className="t-body ellip" style={{ fontWeight: 500 }}>{route}</span>
            <span className="t-body-s muted-2 ellip">{driver}</span>
            <span><span className={`status status--${tone}`}>{status}</span></span>
            <span className="t-body num" style={{ textAlign: "right", fontWeight: 500 }}>{sum}</span>
          </div>
        ))}
        <button className="flatlist__more">Показать ещё 12</button>
      </section>
    ),
    alerts: (
      <section key="alerts" className="widget widget--dark" data-wkey="alerts" data-dragging={dragging === "alerts" || undefined} style={wStyle("alerts")}>
        {rig("alerts", false)}
        <div className="widget__head">
          <span className="t-h2">Требует внимания</span>
          {alerts && alerts.length > 0 && <span className="alerts-badge">{alerts.length}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          {alerts === null ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 10px" }}>Загрузка…</div>
          ) : alerts.length === 0 ? (
            <div className="t-body-s" style={{ color: "var(--text-4)", padding: "12px 10px" }}>Всё под контролем — активных предупреждений нет</div>
          ) : (
            alerts.map((a, i) => (
              <div className={"feed__item" + (a.route ? " feed__item--link" : "")} key={i}
                role={a.route ? "button" : undefined} tabIndex={a.route ? 0 : undefined}
                title={a.route ? "Открыть источник" : undefined}
                onClick={a.route ? () => navigate(a.route!) : undefined}
                onKeyDown={a.route ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(a.route!); } }) : undefined}>
                <span className={`dot dot--${a.tone}`} style={{ marginTop: 5 }} />
                <div className="grow">
                  <div className="feed__title">{a.title}</div>
                  <div className="feed__meta">{a.meta}</div>
                </div>
                {a.when && <span className="feed__when">{a.when}</span>}
                {a.route && <span className="feed__chev" aria-hidden>›</span>}
              </div>
            ))
          )}
        </div>
      </section>
    ),
  };

  const ex = openTrip ? (EXTRAS[openTrip.order] || null) : null;
  const late = openTrip ? (openTrip.kind === "run" && openTrip.to > 22.8) : false;
  const statusTone = openTrip ? (openTrip.kind === "done" ? "idle" : openTrip.kind === "run" ? "ok" : "warn") : "idle";
  const statusLabel = openTrip ? ({ done: "Завершён", run: "В пути", next: "Предстоит" } as const)[openTrip.kind] : "";
  const tripComments = openTrip ? (comments[openTrip.id] || []) : [];

  return (
    <div className="nd">
      <NdMenu active="desk" />

      <main className="main">
        {/* ═══ Шапка ═══ */}
        {isPhone ? (
          <NdPhoneHead title="Рабочий стол" subtitle="пн, 6 авг · нед. 32" />
        ) : (
          <header className="topbar">
            <div className="topbar__title">
              <h1 className="t-h1" style={{ margin: 0 }}>Рабочий стол</h1>
              <span className="t-mono muted">пн, 6 авг · нед. 32</span>
            </div>
            <div className="spacer" />

            <div className="search">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="6.2" cy="6.2" r="4.2" /><path d="M9.4 9.4 12.6 12.6" /></svg>
              <span>Рейс, машина, водитель…</span>
              <span className="search__hint">⌘K</span>
            </div>

            <button className={editing ? "btn btn--accent" : "btn btn--ghost"} onClick={() => setEditing(e => !e)}>
              <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="1.5" width="10" height="10" rx="2" /><path d="M8 4.5v6" /></svg>
              <span>{editing ? "Готово" : "Настроить стол"}</span>
            </button>
          </header>
        )}

        <div className="contentrow">
          {/* ═══ Сетка виджетов ═══ */}
          <div className="workarea" data-edit={editing} ref={workRef}>
            {L.order.map(k => widgets[k])}
          </div>

          {/* ═══ Панель настройки ═══ */}
          {editing && (
            <aside className="settings">
              <div>
                <div className="t-h2">Настройка стола</div>
                <p className="t-body-s muted" style={{ lineHeight: 1.45, margin: "5px 0 0" }}>
                  Тяните виджет за ручку «Перенести», чтобы поменять место, и за правую
                  или нижнюю границу — чтобы изменить размер. Крестик убирает блок,
                  вернуть — отсюда. Раскладка сохраняется за учётной записью.
                </p>
              </div>
              <div className="row-c" style={{ justifyContent: "space-between", padding: "11px 12px", borderRadius: "var(--r-md)", background: "var(--surface-3)" }}>
                <span className="t-body-s" style={{ fontWeight: 500 }}>Сетка стола</span>
                <span className="t-mono muted-2" style={{ fontWeight: 500 }}>12 колонок</span>
              </div>

              <div className="t-mono-label" style={{ letterSpacing: ".08em" }}>Скрытые блоки</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {hiddenKeys.length ? hiddenKeys.map(k => (
                  <button className="settings__add" key={k} onClick={() => addWidget(k)}>
                    <i>+</i><span style={{ flex: 1 }}>{WIDGET_NAMES[k]}</span>
                  </button>
                )) : <div className="t-body-s" style={{ color: "var(--text-4)", padding: "4px 2px" }}>Все блоки на столе</div>}
              </div>

              <div className="t-mono-label" style={{ letterSpacing: ".08em", marginTop: 6 }}>Пресеты</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button className="settings__preset" onClick={() => applyPreset("dispatch")}><span className="t-h3">Диспетчерский</span><span className="t-caption muted-2">Смена, рейсы и внимание</span></button>
                <button className="settings__preset" onClick={() => applyPreset("analytics")}><span className="t-h3">Аналитика</span><span className="t-caption muted-2">Показатели и динамика</span></button>
                <button className="settings__preset" onClick={() => applyPreset("all")}><span className="t-h3">Всё сразу</span><span className="t-caption muted-2">Полная раскладка</span></button>
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* ═══ Панель рейса ═══ */}
      {openTrip && (
        <div className="nd-overlay nd-overlay--right" onClick={e => { if (e.target === e.currentTarget) setOpenTrip(null); }}>
          <div className="nd-modal nd-modal--panel nd">
            <div className="nd-modal__head">
              <div className="row-c" style={{ gap: 8 }}>
                <span className={`status status--${statusTone}`}>{statusLabel}</span>
                <span className="t-mono muted" style={{ fontWeight: 500 }}>{openTrip.order}</span>
                <span className={`t-caption ${late ? "neg" : "pos"}`} style={{ fontWeight: 600 }}>{late ? "опоздание +40 мин" : "по графику"}</span>
              </div>
              <div className="t-h1" style={{ fontSize: 19, marginTop: 10, lineHeight: 1.25 }}>{openTrip.route}</div>
              <div className="t-mono muted" style={{ marginTop: 5 }}>{hhmm(openTrip.from)} – {hhmm(openTrip.to)} · {openTrip.plate} · {openTrip.driver}</div>
            </div>

            <div className="nd-modal__body">
              <div className="nd-facts">
                {[
                  ["Заявка", openTrip.order], ["Машина", openTrip.plate], ["Водитель", openTrip.driver],
                  ["Окно", `${hhmm(openTrip.from)} – ${hhmm(openTrip.to)}`], ["Расстояние", `${ex?.km ?? 0} км`],
                  ["Груз", ex?.cargo ?? "—"], ["Вес", ex?.weight ?? "—"], ["Режим", ex?.temp ?? "—"],
                  ["Ворота", ex?.gate ?? "—"], ["Сумма", ex?.sum ?? "—"],
                ].map(([l, v]) => (
                  <div className="nd-facts__row" key={l}><span className="nd-facts__label">{l}</span><span className="nd-facts__value">{v}</span></div>
                ))}
              </div>

              <div style={{ background: "var(--surface)", borderRadius: "var(--r-xl)", padding: "16px 18px" }}>
                <div className="row-c" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                  <span className="t-h3">Комментарии</span>
                  <span className="t-mono" style={{ color: "var(--text-4)" }}>видны диспетчерам</span>
                </div>
                <div className="nd-comments">
                  {tripComments.map((c, i) => (
                    <div className="nd-comment" key={i}>
                      <span className="avatar" style={{ width: 28, height: 28 }}>{initials}</span>
                      <div className="nd-comment__bubble">
                        <div className="row-b" style={{ gap: 8 }}>
                          <span className="t-body-s" style={{ fontWeight: 600 }}>{c.author}</span>
                          <span className="nd-panel-note">{c.when}</span>
                        </div>
                        <div className="nd-comment__text">{c.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="field">
                  <textarea
                    rows={3}
                    placeholder="Что важно знать по рейсу…"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") addComment(); }}
                  />
                </div>
                <div className="row-c gap-10" style={{ marginTop: 10 }}>
                  <span className="t-mono grow" style={{ fontSize: 10.5, color: "var(--text-4)" }}>⌘ + Enter — отправить</span>
                  <button className={draft.trim() ? "btn btn--primary" : "btn"} disabled={!draft.trim()} onClick={addComment}>Добавить</button>
                </div>
              </div>
            </div>

            <div className="nd-modal__foot">
              <button className="btn btn--primary btn--lg" style={{ flex: 1 }}>Открыть рейс</button>
              <button className="btn btn--ghost btn--lg">Сменить водителя</button>
              <button className="btn btn--accent btn--lg">Позвонить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Табло рейсов
// ────────────────────────────────────────────────────────────────────────────
const GUTTER = 112;                          // ширина колонки с именем водителя
function Board({ onOpen, span }: { onOpen: (t: OpenTrip) => void; span: number }) {
  const [pan, setPan] = useState(0);         // сдвиг окна по времени, ч (перетаскивание)
  const gridRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  useEffect(() => { setPan(0); }, [span]);   // смена окна — сброс сдвига (снова 1/3)

  // Данные есть на ±24 ч → окно можно двигать в этих пределах.
  const clampPan = (p: number) => {
    const base = boardStart(span);
    const min = (NOW - 24) - base;           // левый край не дальше NOW-24
    const max = (NOW + 24 - span) - base;    // правый край не дальше NOW+24
    return Math.max(min, Math.min(max, p));
  };
  const viewStart = boardStart(span) + pan;  // при pan=0 → «сейчас» на 1/3
  const viewEnd = viewStart + span;
  const pctB = (h: number) => ((h - viewStart) / span) * 100;
  const ticks: number[] = [];                // подписи/сетка — целые часы внутри окна
  for (let t = Math.ceil(viewStart); t <= Math.floor(viewEnd); t++) ticks.push(t);
  const nowPct = pctB(NOW);                   // линия «сейчас» двигается вместе с окном

  function onPanStart(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const grid = gridRef.current; if (!grid) return;
    const laneW = grid.clientWidth - GUTTER;
    const startX = e.clientX, startPan = pan;
    movedRef.current = false;
    startDrag(ev => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 3) movedRef.current = true;
      setPan(clampPan(startPan - (dx / laneW) * span));   // тянем вправо → видим более раннее
    });
  }

  return (
    <div className="board__grid board__grid--pan" ref={gridRef} onMouseDown={onPanStart}>
      <div className="board__axis">
        <div className="board__gutter" />
        <div className="board__scale">
          {ticks.map(t => <span key={t} className="board__tick" style={{ left: `${pctB(t).toFixed(3)}%` }}>{hhmm(t)}</span>)}
        </div>
      </div>
      {BOARD.map(([driver, plate, bars], ri) => (
        <div className="board__row" key={ri}>
          <div className="board__name">
            <span className="t-body-s ellip" style={{ fontWeight: 600 }}>{driver}</span>
            <span style={{ font: "400 10px var(--font-mono)", color: "var(--text-4)" }}>{plate}</span>
          </div>
          <div className="board__lane">
            {ticks.map(t => <i key={t} className="board__gridline" style={{ left: `${pctB(t).toFixed(3)}%` }} />)}
            {bars.map(([from, to, route, order, kind], bi) => {
              const a = Math.max(from, viewStart), b = Math.min(to, viewEnd);
              if (b <= a) return null;
              return (
                <button
                  key={bi}
                  className={`trip trip--${kind}`}
                  style={{ left: `${pctB(a).toFixed(3)}%`, width: `${(pctB(b) - pctB(a)).toFixed(3)}%` }}
                  onClick={() => { if (movedRef.current) return; onOpen({ id: `${ri}-${bi}`, route, order, driver, plate, from, to, kind }); }}
                >
                  <div className="trip__route">{route}</div>
                  <div className="trip__meta">{hhmm(from)}–{hhmm(to)} · {order}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {nowPct >= 0 && nowPct <= 100 && (
        <div className="board__now" style={{ left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${(nowPct / 100).toFixed(4)})` }}><i /></div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// График динамики
// ────────────────────────────────────────────────────────────────────────────
// График динамики: столбцы + ось. Ось адаптивна к ширине виджета — подписи
// прореживаются (ResizeObserver), чтобы не наезжали на узком столе.
function ChartView({ values, labels, peak }: { values: number[]; labels: string[]; peak: number }) {
  const max = Math.max(1, ...values);
  const axisRef = useRef<HTMLDivElement>(null);
  const [stride, setStride] = useState(1);
  useEffect(() => {
    const el = axisRef.current; if (!el) return;
    const calc = () => {
      const fit = Math.max(1, Math.floor(el.clientWidth / 46));   // ~46px на подпись
      setStride(Math.max(1, Math.ceil(labels.length / fit)));
    };
    calc();
    const ro = new ResizeObserver(calc); ro.observe(el);
    return () => ro.disconnect();
  }, [labels.length]);
  return (
    <>
      <div className="chart">
        {values.map((v, i) => (
          <i key={i} className={i === peak ? "is-peak" : ""} style={{ height: `${Math.round((v / max) * 100)}%`, animationDelay: `${Math.min(i * 18, 260)}ms` }} />
        ))}
      </div>
      <div className="chart__axis" ref={axisRef}>
        {labels.map((l, i) => <span key={i} style={{ visibility: i % stride === 0 || i === labels.length - 1 ? "visible" : "hidden" }}>{l}</span>)}
      </div>
    </>
  );
}
