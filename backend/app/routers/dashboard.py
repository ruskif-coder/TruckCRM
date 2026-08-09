"""Dashboard endpoint - rewritten 2026-06-26 (task #55) to read the live
Trip/FuelRecord/CashFlowEntry tables instead of the dormant TripBatch/
Expense ones (see calculations.py module docstring for why those were
dropped). The data contract below is new and matches the rebuilt
Dashboard.tsx, not the old {trips_count, gross_revenue, total, ...} shape -
nothing else consumed the old shape (confirmed: Dashboard.tsx was the only
caller, and it was itself 100% demo-data/disconnected before this change).

Scope decided with the user: build from what the live schema actually
tracks (Trip.amount/fines, FuelRecord.amount, CashFlowEntry income/expense),
not a fabricated P&L. Trip has no commission_pct/driver_pay/profitability
fields (task #103, separate), so this endpoint does not compute a single
"net profit" number - trip revenue/fines and cashflow income/expense are
reported as separate, honest line items rather than merged into one figure
that could double-count (e.g. CashFlowEntry's "Топливо" category vs.
FuelRecord rows may or may not represent the same spend - not safe to
assume either way without asking the user, which the task itself doesn't
need answered to ship the rest of this).
"""

import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from .. import models
from ..auth import require_zone
from ..calculations import cashflow_in_range, commission_pct_for, doc_status, iso_week_monday, maintenance_status, round2, trip_in_range, weekly_pnl
from ..database import get_session

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])
# Роли по API (2026-06-28; настраивается через "Настройки -> Роли" с того же
# дня, см. permissions.py): дашборд/отчёты показывают сводку по всему
# автопарку - зона "dashboard" (read-only - тут только GET). Роли "driver"
# по умолчанию доступа нет (только собственные рейсы/заправки напрямую
# через /api/trips, /api/fuel, см. crud.py own_filter_field).
_staff = [Depends(require_zone("dashboard", "read"))]

TREND_WEEKS = 8
TOP_TRUCKS = 8


def get_settings(session: Session) -> models.Settings:
    settings = session.get(models.Settings, 1)
    if not settings:
        settings = models.Settings(id=1)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def _week_bar_label(monday: date) -> str:
    sunday = monday + timedelta(days=6)
    return f"{monday.day}–{sunday.day}"


@router.get("/", dependencies=_staff)
def dashboard(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    session: Session = Depends(get_session),
):
    settings = get_settings(session)
    today = date.today()
    now = datetime.now()

    # По умолчанию - последние 30 дней (тот же диапазон, что и на страницах
    # Рейсы/Топливо) - не "весь период", иначе первая загрузка тащит всю
    # историю и искажает сравнение с предыдущим периодом.
    if date_to is None:
        date_to = today
    if date_from is None:
        date_from = date_to - timedelta(days=30)

    period_days = (date_to - date_from).days + 1
    prev_date_to = date_from - timedelta(days=1)
    prev_date_from = prev_date_to - timedelta(days=period_days - 1)

    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    cashflow = session.exec(select(models.CashFlowEntry)).all()
    trucks = session.exec(select(models.Truck)).all()
    drivers = session.exec(select(models.Driver)).all()
    carriers = session.exec(select(models.Carrier)).all()
    mileage_logs = session.exec(select(models.MileageLog)).all()
    documents = session.exec(select(models.Document)).all()

    truck_label = {t.id: (t.label or t.plate or f"Машина #{t.id}") for t in trucks}

    def fuel_sum(d_from: date, d_to: date) -> float:
        return sum(f.amount or 0 for f in fuel_records if f.date and d_from <= f.date.date() <= d_to)

    def net_revenue(t: models.Trip) -> float:
        """Выручка после вычета комиссии перевозчика (нетто)."""
        gross = t.amount or 0
        pct = commission_pct_for(t.carrier_name, carriers, settings)
        return round2(gross * (1 - pct / 100))

    def kpi_for(d_from: date, d_to: date):
        in_range = [t for t in trips if trip_in_range(t, d_from, d_to)]
        return {
            "trips_count": len(in_range),
            "revenue": round2(sum(net_revenue(t) for t in in_range)),
            "fines": sum(t.fines or 0 for t in in_range),
            "fuel_cost": fuel_sum(d_from, d_to),
        }, in_range

    current, trips_in_period = kpi_for(date_from, date_to)
    previous, _ = kpi_for(prev_date_from, prev_date_to)

    kpi = {
        "trips_count": current["trips_count"],
        "trips_count_prev": previous["trips_count"],
        "revenue": current["revenue"],
        "revenue_prev": previous["revenue"],
        "fines": current["fines"],
        "fines_prev": previous["fines"],
        "fuel_cost": current["fuel_cost"],
        "fuel_cost_prev": previous["fuel_cost"],
    }

    # По машинам за период - тот же разрез, что в TCargo 2025.xlsx
    # (выручка/рейсы/штрафы по машине), посчитанный по живым Trip вместо
    # импортированных недельных батчей.
    by_truck_acc: dict = defaultdict(lambda: {"trips_count": 0, "revenue": 0.0, "fines": 0.0})
    for t in trips_in_period:
        if t.truck_id is None:
            continue
        acc = by_truck_acc[t.truck_id]
        acc["trips_count"] += 1
        acc["revenue"] += net_revenue(t)
        acc["fines"] += t.fines or 0
    by_truck = sorted(
        (
            {"truck_id": tid, "label": truck_label.get(tid, f"Машина #{tid}"), **acc}
            for tid, acc in by_truck_acc.items()
        ),
        key=lambda r: r["revenue"],
        reverse=True,
    )[:TOP_TRUCKS]

    # Тренд по неделям - последние TREND_WEEKS ISO-недель, заканчивающиеся
    # последней неделей, на которую есть хотя бы один рейс, а не буквально
    # "сегодняшней" неделей (по просьбе пользователя 2026-06-28): если за
    # текущую неделю рейсов ещё нет (начало недели, данные не внесены),
    # график не должен заканчиваться пустым нулевым провалом - последней
    # точкой считается последняя неделя с реальными данными. Топливный
    # график использует тот же якорь (привязан к наличию РЕЙСОВ, а не своих
    # заправок) - так оба графика на дашборде показывают один и тот же набор
    # недель и остаются согласованными между собой.
    trip_weeks_with_data = {iso_week_monday(t.dep_at.date()) for t in trips if t.dep_at}
    trend_to_monday = max(trip_weeks_with_data) if trip_weeks_with_data else iso_week_monday(today)
    # Якорь не может уехать в будущее относительно текущей недели (если
    # самый "свежий" рейс почему-то запланирован позже - например, плановый
    # будущий рейс с заполненной датой отправления).
    trend_to_monday = min(trend_to_monday, iso_week_monday(today))
    week_starts = [trend_to_monday - timedelta(weeks=(TREND_WEEKS - 1 - i)) for i in range(TREND_WEEKS)]
    trips_by_week = {ws: 0 for ws in week_starts}
    fuel_by_week = {ws: 0.0 for ws in week_starts}
    fuel_volume_by_week = {ws: 0.0 for ws in week_starts}
    for t in trips:
        if not t.dep_at:
            continue
        wk = iso_week_monday(t.dep_at.date())
        if wk in trips_by_week:
            trips_by_week[wk] += 1
    for f in fuel_records:
        if not f.date:
            continue
        wk = iso_week_monday(f.date.date())
        if wk in fuel_by_week:
            fuel_by_week[wk] += f.amount or 0
            fuel_volume_by_week[wk] += f.volume or 0

    # Выручка (нетто) по неделям — параллельно trips_by_week.
    revenue_by_week = {ws: 0.0 for ws in week_starts}
    for t in trips:
        if not t.dep_at:
            continue
        wk = iso_week_monday(t.dep_at.date())
        if wk in revenue_by_week:
            revenue_by_week[wk] += net_revenue(t)

    # Пробег по неделям — разбег одометра по каждой машине (последовательные
    # положительные дельты), дельта относится к неделе более поздней записи.
    km_by_week = {ws: 0.0 for ws in week_starts}
    logs_by_truck: dict = defaultdict(list)
    for lg in mileage_logs:
        if lg.odometer is not None and lg.date:
            logs_by_truck[lg.truck_id].append(lg)
    for _tid, logs in logs_by_truck.items():
        logs.sort(key=lambda x: x.date)
        for prev, cur in zip(logs, logs[1:]):
            delta = (cur.odometer or 0) - (prev.odometer or 0)
            if delta <= 0:
                continue
            wk = iso_week_monday(cur.date)
            if wk in km_by_week:
                km_by_week[wk] += delta

    trips_trend = [
        {"d": _week_bar_label(ws), "v": trips_by_week[ws], "hi": ws == week_starts[-1]} for ws in week_starts
    ]
    fuel_values = [fuel_by_week[ws] for ws in week_starts]
    fuel_volumes = [fuel_volume_by_week[ws] for ws in week_starts]
    fuel_peak_idx = max(range(len(fuel_values)), key=lambda i: fuel_values[i]) if any(fuel_values) else len(fuel_values) - 1
    trend_labels = [_week_bar_label(ws) for ws in week_starts]

    def _peak(vals):
        return max(range(len(vals)), key=lambda i: vals[i]) if any(vals) else len(vals) - 1

    trend = {
        "trips": trips_trend,
        "trips_total": sum(trips_by_week.values()),
        # Метрики графика «динамика по неделям» (2026-08): 3 переключателя.
        "metrics": {
            "trips": {
                "values": [trips_by_week[ws] for ws in week_starts],
                "labels": trend_labels, "unit": "рейс.",
                "total": sum(trips_by_week.values()),
                "peak_idx": _peak([trips_by_week[ws] for ws in week_starts]),
            },
            "revenue": {
                "values": [round2(revenue_by_week[ws]) for ws in week_starts],
                "labels": trend_labels, "unit": "₽",
                "total": round2(sum(revenue_by_week.values())),
                "peak_idx": _peak([revenue_by_week[ws] for ws in week_starts]),
            },
            "km": {
                "values": [round2(km_by_week[ws]) for ws in week_starts],
                "labels": trend_labels, "unit": "км",
                "total": round2(sum(km_by_week.values())),
                "peak_idx": _peak([km_by_week[ws] for ws in week_starts]),
            },
        },
        "fuel": {
            "days": fuel_values,
            # Литры по неделям (2026-06-28) - для подсказки при наведении на
            # график топлива во Dashboard.tsx, параллельный массив к "days".
            "volumes": fuel_volumes,
            "labels": [_week_bar_label(ws) for ws in week_starts],
            "peak_idx": fuel_peak_idx,
            "peak_label": f"{fuel_values[fuel_peak_idx]:,.0f} ₽".replace(",", " "),
            "total": sum(fuel_values),
        },
    }

    # "Сегодня" - честная замена несуществующего live-GPS трекинга. Изначально
    # активность определялась через end_at (dep_at <= сейчас <= end_at, либо
    # end_at не заполнен), но сверка с реальной БД 2026-06-26 показала, что
    # это даёт неверную картину: 12 рейсов без end_at, из них 11 на самом деле
    # уже "Завершено" (импорт просто не принёс дату окончания) - они ложно
    # считались бы "в рейсе". Статус заявки - надёжный признак: только
    # "Получен ответ" значит "ещё не завершён и не отменён".
    active_today = [t for t in trips if t.dep_at and t.dep_at <= now and t.status not in ("Завершено", "Отменено")]
    departed_today = [t for t in trips if t.dep_at and t.dep_at.date() == today]
    today_stats = {
        "active_trips": len(active_today),
        "active_trucks": len({t.truck_id for t in active_today if t.truck_id is not None}),
        "active_drivers": len({t.driver_id for t in active_today if t.driver_id is not None}),
        "departed_today": len(departed_today),
    }

    # Денежный поток за период (CashFlowEntry) - отдельный разрез, не
    # смешивается с выручкой/штрафами по рейсам (см. docstring модуля).
    cashflow_in_period = [e for e in cashflow if cashflow_in_range(e, date_from, date_to)]
    cf_income = sum(e.income or 0 for e in cashflow_in_period)
    cf_expense = sum(e.expense or 0 for e in cashflow_in_period)
    by_category_acc: dict = defaultdict(float)
    for e in cashflow_in_period:
        if e.expense:
            by_category_acc[e.category or "Без категории"] += e.expense
    by_category = sorted(
        ({"category": k, "value": v} for k, v in by_category_acc.items()),
        key=lambda r: r["value"],
        reverse=True,
    )
    cashflow_summary = {
        "income": cf_income,
        "expense": cf_expense,
        "net": cf_income - cf_expense,
        "by_category": by_category,
    }

    # Алерты по ТО/документам - логика не менялась, только импорт из
    # calculations.py (уже работала на живых Truck/MileageLog/Document).
    alerts = []
    for t in trucks:
        ms = maintenance_status(t, mileage_logs, settings)
        if ms.get("known") and ms.get("remaining") is not None:
            if ms["overdue"]:
                alerts.append(
                    {
                        "level": "bad",
                        "message": f"ТО просрочено: {t.label} — пробег превышает интервал на {abs(ms['remaining']):.0f} км",
                    }
                )
            elif ms["soon"]:
                alerts.append(
                    {
                        "level": "warn",
                        "message": f"Скоро ТО: {t.label} — через {ms['remaining']:.0f} км",
                    }
                )
    for doc in documents:
        st = doc_status(doc)
        doc_truck_label = next((t.label for t in trucks if t.id == doc.truck_id), None)
        suffix = f" ({doc_truck_label})" if doc_truck_label else ""
        if st["status"] == "expired":
            alerts.append(
                {
                    "level": "bad",
                    "message": f"Документ просрочен: {doc.type}{suffix} — истёк {abs(st['days'])} дн. назад",
                }
            )
        elif st["status"] == "soon":
            alerts.append(
                {
                    "level": "warn",
                    "message": f"Истекает: {doc.type}{suffix} — через {st['days']} дн.",
                }
            )

    return {
        "period": {"date_from": date_from, "date_to": date_to},
        "kpi": kpi,
        "by_truck": by_truck,
        "trend": trend,
        "today": today_stats,
        "cashflow": cashflow_summary,
        "alerts": alerts,
        "fleet_size": len(trucks),
    }


# 2026-06-26 (task #129): "Расчёт по неделям" - the P&L breakdown the user
# asked for after sharing TCargo 2025.xlsx ("Сводная OZON"), replicated on
# live Trip/FuelRecord data and bucketed by calendar week instead of the
# spreadsheet's driver-change-split sub-periods. See calculations.py::
# weekly_pnl() docstring/comment for exactly which two inputs (driver %,
# commission % source) were confirmed with the user rather than guessed.
# "Платная дорога" (toll): до 2026-06-28 не отслеживалась нигде и всегда
# показывалась как 0; с этой даты вносится вручную в реестр расходов
# (категория "Платная дорога", сумма за неделю + привязка машина/водитель,
# см. models.py и calculations.py::weekly_pnl). Оговорка ниже теперь зависит
# от того, есть ли реально внесённые суммы в выбранном периоде, а не статична.
_TOLL_LIVE_NOTE = (
    "Платная дорога считается по реестру расходов (категория «Платная дорога»), "
    "по сумме за неделю с привязкой к машине и водителю — не отдельная модель."
)
_TOLL_ZERO_NOTE = (
    "Платная дорога за выбранный период не внесена в реестр расходов (категория «Платная дорога») — "
    "показана как 0, не выдумана."
)
_COMMISSION_NOTE = (
    "% комиссии берётся из поля «% СК» перевозчика (совпадает с фактической комиссией ОЗОН), "
    "либо из настройки по умолчанию, если перевозчик не найден."
)
_DRIVER_REAL_NOTE = (
    "% водителя считается по условиям оплаты, заданным в карточке водителя "
    "(«Условия оплаты»: перевозчик → формат → условие)."
)
_DRIVER_FALLBACK_NOTE = (
    "Для части строк условие оплаты не задано, либо задано как «За км»/«Оклад» "
    "(нет данных по пробегу за рейс и нет честного способа разнести оклад по неделям/машинам) — "
    "временно используется плейсхолдер 30%."
)


# Кэш результата /weekly: снижает нагрузку при повторных запросах в течение
# одной сессии (пользователь переключает вкладки, обновляет страницу).
# TTL 90 сек — достаточно для интерактивной работы, данные не устареют заметно.
# Инвалидируется автоматически по TTL; хранит не более 20 записей (разные
# date_from/date_to), чтобы не накапливать память при долгой работе сервера.
_weekly_cache: dict = {}
_WEEKLY_CACHE_TTL = 90  # секунды


def _weekly_notes(rows: list) -> list:
    """Builds the disclaimer list dynamically from what `rows` actually used
    for the driver-payout figure (see calculations.py::weekly_pnl
    `driver_rate_source`), instead of a static claim that's gone stale now
    that real DriverRate rows exist (2026-06-28)."""
    sources = {r["driver_rate_source"] for r in rows}
    notes = [_TOLL_LIVE_NOTE if any(r["toll"] for r in rows) else _TOLL_ZERO_NOTE]
    if sources & {"percentOfNet", "perTrip"}:
        notes.append(_DRIVER_REAL_NOTE)
    if sources & {"placeholder", "perKm_fallback", "salary_fallback"}:
        notes.append(_DRIVER_FALLBACK_NOTE)
    notes.append(_COMMISSION_NOTE)
    return notes


@router.get("/weekly", dependencies=_staff)
def weekly(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    session: Session = Depends(get_session),
):
    # Проверяем кэш до любых запросов в БД
    cache_key = f"{date_from}:{date_to}"
    now_ts = time.time()
    if (entry := _weekly_cache.get(cache_key)) and (now_ts - entry["ts"]) < _WEEKLY_CACHE_TTL:
        return entry["data"]

    settings = get_settings(session)
    today = date.today()

    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    trucks = session.exec(select(models.Truck)).all()
    drivers = session.exec(select(models.Driver)).all()
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()
    cash_flow_entries = session.exec(select(models.CashFlowEntry)).all()

    trip_days = [t.dep_at.date() for t in trips if t.dep_at]

    if date_from is None and date_to is None:
        # Дефолт для этого разреза (2026-06-26, по просьбе пользователя):
        # последние 4 календарные недели, считая от последнего воскресенья,
        # на которое есть данные (конец недели последнего рейса в базе) -
        # не от "сегодня", иначе пустая текущая неделя без рейсов съедала бы
        # один из четырёх показанных периодов.
        anchor_day = max(trip_days) if trip_days else today
        anchor_monday = iso_week_monday(anchor_day)
        date_to = anchor_monday + timedelta(days=6)
        date_from = anchor_monday - timedelta(weeks=3)
    else:
        if date_to is None:
            date_to = today
        if date_from is None:
            # Честный дефолт, если задан только date_to: не обрезаем историю
            # 30 днями, берём дату самого первого рейса в базе.
            date_from = min(trip_days) if trip_days else date_to - timedelta(days=30)

    truck_label = {t.id: (t.label or t.plate or f"Машина #{t.id}") for t in trucks}
    # truck_plate — гос.номер из таблицы Truck (нормализованный), используется
    # для drill-down из Отчётов в Реестр поездок: Trips.tsx фильтрует рейсы
    # по truck.plate, поэтому URL-параметр должен содержать именно plate, а не
    # произвольный label, который пользователь мог переименовать.
    truck_plate = {t.id: (t.plate or t.label or f"Машина #{t.id}") for t in trucks}
    driver_label = {d.id: d.name for d in drivers}

    rows = weekly_pnl(trips, fuel_records, carriers, settings, date_from, date_to, driver_rates, cash_flow_entries)

    weeks: dict = {}
    for r in rows:
        wk = r["week_start"]
        bucket = weeks.setdefault(
            wk,
            {"week_start": wk, "week_end": r["week_end"], "rows": [], "totals": defaultdict(float)},
        )
        bucket["rows"].append(
            {
                **r,
                "truck_label": truck_label.get(r["truck_id"], f"Машина #{r['truck_id']}") if r["truck_id"] else "—",
                "truck_plate": truck_plate.get(r["truck_id"], f"Машина #{r['truck_id']}") if r["truck_id"] else "—",
                "driver_label": driver_label.get(r["driver_id"], f"Водитель #{r['driver_id']}") if r["driver_id"] else "—",
            }
        )
        for k in ("trips", "gross", "commission_rub", "net", "fines", "toll", "fuel", "driver_payout", "profit"):
            bucket["totals"][k] += r[k]

    result_weeks = []
    for wk in sorted(weeks):
        b = weeks[wk]
        totals = dict(b["totals"])
        # Округление сумм по неделе (2026-06-29, см. calculations.py::round2) -
        # сами строки уже округлены, но суммирование float'ов само по себе
        # может дать "хвост" в 17-м знаке (классика - 0.1+0.2=0.30000000000000004),
        # поэтому округляем ещё раз после сложения, а не только на уровне строк.
        for k in ("gross", "commission_rub", "net", "fines", "toll", "fuel", "driver_payout", "profit"):
            totals[k] = round2(totals[k])
        totals["profitability"] = (totals["profit"] / totals["net"]) if totals["net"] else None
        result_weeks.append(
            {
                "week_start": b["week_start"],
                "week_end": b["week_end"],
                "rows": b["rows"],
                "totals": totals,
            }
        )

    result = {
        "period": {"date_from": date_from, "date_to": date_to},
        "weeks": result_weeks,
        "notes": _weekly_notes(rows),
    }

    # Сохраняем в кэш; ограничиваем размер кэша 20 записями
    _weekly_cache[cache_key] = {"ts": now_ts, "data": result}
    if len(_weekly_cache) > 20:
        oldest_key = min(_weekly_cache, key=lambda k: _weekly_cache[k]["ts"])
        del _weekly_cache[oldest_key]

    return result


@router.get("/expiring-docs", dependencies=_staff)
def expiring_docs(session: Session = Depends(get_session)):
    """Документы с истекающим сроком действия (в течение 60 дней).

    Проверяемые поля:
    - Truck: ОСАГО (osago_date), КАСКО (kasko_date), Техосмотр (tech_inspection_date)
    - Driver: Права (license_valid_until), СКЗИ (skzi_valid_until)

    Уровни:
    - expired  : просрочено (days_left < 0)
    - critical : < 14 дней
    - warn     : 14–30 дней
    - notice   : 30–60 дней
    """
    today = date.today()
    items = []

    trucks = session.exec(select(models.Truck)).all()
    drivers = session.exec(select(models.Driver)).all()

    truck_doc_fields = [
        ("osago_date", "ОСАГО"),
        ("kasko_date", "КАСКО"),
        ("tech_inspection_date", "Техосмотр"),
        ("moscow_pass_date", "Пропуск Москва"),
    ]
    for truck in trucks:
        label = truck.label or truck.plate or f"Машина #{truck.id}"
        for field, doc_name in truck_doc_fields:
            exp_date = getattr(truck, field, None)
            if not exp_date:
                continue
            days_left = (exp_date - today).days
            if days_left >= 60:
                continue
            items.append({
                "entity_type": "truck",
                "entity_id": truck.id,
                "entity_label": label,
                "doc_type": doc_name,
                "expiry_date": exp_date.isoformat(),
                "days_left": days_left,
                "level": (
                    "expired" if days_left < 0 else
                    "critical" if days_left < 14 else
                    "warn" if days_left < 30 else
                    "notice"
                ),
            })

    driver_doc_fields = [
        ("license_valid_until", "Права"),
        ("skzi_valid_until", "СКЗИ"),
    ]
    for driver in drivers:
        for field, doc_name in driver_doc_fields:
            exp_date = getattr(driver, field, None)
            if not exp_date:
                continue
            days_left = (exp_date - today).days
            if days_left >= 60:
                continue
            items.append({
                "entity_type": "driver",
                "entity_id": driver.id,
                "entity_label": driver.name,
                "doc_type": doc_name,
                "expiry_date": exp_date.isoformat(),
                "days_left": days_left,
                "level": (
                    "expired" if days_left < 0 else
                    "critical" if days_left < 14 else
                    "warn" if days_left < 30 else
                    "notice"
                ),
            })

    items.sort(key=lambda x: x["days_left"])
    critical_count = sum(1 for i in items if i["level"] in ("expired", "critical"))
    return {"items": items, "total": len(items), "critical_count": critical_count}
