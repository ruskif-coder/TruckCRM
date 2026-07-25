"""Дашборд водителя (мобильный, 2026-06-30) — "дашборд для водителя для
работы через мобильный телефон":
  1. баланс - сумма незакрытой выплаты водителю
  2. кол-во рейсов за последнюю отчётную неделю
  3. быстрое добавление расхода (→ CashFlowEntry, видно в реестре расходов)

Все эндпойнты auth-only (без zone-check): по определению работают только с
данными самого вошедшего водителя. Водитель не может получить данные другого
водителя через эти маршруты - driver_id берётся из токена, не из тела запроса.
"""
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user
from ..calculations import (
    DRIVER_PCT_PLACEHOLDER,
    commission_pct_for,
    driver_rate_for,
    iso_week_monday,
    weekly_pnl,
)
from ..database import get_session

router = APIRouter(prefix="/api/driver-dashboard", tags=["driver-dashboard"])


def _get_settings(session: Session) -> models.Settings:
    s = session.get(models.Settings, 1)
    if not s:
        s = models.Settings(id=1)
        session.add(s)
        session.commit()
        session.refresh(s)
    return s


@router.get("/summary")
def driver_summary(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Баланс (сумма незакрытой выплаты) и кол-во рейсов за последнюю
    отчётную неделю для текущего водителя.

    "Баланс" = sum(driver_payout - driver_paid) по всем неделям истории, где
    driver_payout > driver_paid. driver_payout считается через calculations::
    weekly_pnl (тот же алгоритм, что в Отчётах), driver_paid = сумма проводок
    "Расчёт с водителем" в реестре расходов за ту же (неделя, машина, водитель).
    Разница = ещё не выплаченная часть расчётной суммы.

    "Последняя отчётная неделя" = последний завершённый ISO-понедельник
    (iso_week_monday(today) - 7 дней). Кол-во СВОИХ рейсов за ту неделю -
    простой COUNT без расчёта P&L.
    """
    if not user.driver_id:
        # Не водитель (нет linked Driver record) - пустой ответ, не ошибка:
        # функция может быть вызвана любым залогиненным пользователем, но
        # полезна только водителям. Фронтенд (DriverDashboard.tsx) это знает.
        return {
            "driver_id": None,
            "driver_name": user.full_name or user.username,
            "balance": 0.0,
            "as_of": None,
            "last_week_trips": 0,
            "last_week_cancelled": 0,
            "last_week_start": None,
        }

    today = date.today()
    settings = _get_settings(session)

    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()
    cash_flow_entries = session.exec(select(models.CashFlowEntry)).all()

    # Все недели с начала истории до сегодня (date_from=None = без нижней границы)
    rows = weekly_pnl(trips, fuel_records, carriers, settings, None, today, driver_rates, cash_flow_entries)

    # Фильтруем только строки нашего водителя
    driver_rows = [r for r in rows if r.get("driver_id") == user.driver_id]

    # Базовый баланс = сумма незакрытых выплат по неделям
    weekly_unpaid = sum(max(0.0, r["driver_payout"] - r["driver_paid"]) for r in driver_rows)

    # Корректировки из DriverTransaction (компенсации, штрафы, авансы)
    tx_sum_result = session.exec(
        select(func.sum(models.DriverTransaction.amount)).where(
            models.DriverTransaction.driver_id == user.driver_id
        )
    ).one()
    tx_sum = float(tx_sum_result or 0.0)

    balance = round(weekly_unpaid + tx_sum, 2)

    # Дата последней недели с данными водителя (для подписи "данные на X")
    as_of: date | None = None
    if driver_rows:
        as_of = max(r["week_end"] for r in driver_rows)

    # Рейсы за ту же неделю, что дала последнее начисление (as_of).
    # Если данных нет — берём прошлую календарную неделю как fallback.
    # Это устраняет рассинхрон: баланс "на 21.06" показывался рядом с
    # рейсами "за 22–28.06" (разные недели).
    if as_of:
        billing_monday = iso_week_monday(as_of)
    else:
        billing_monday = iso_week_monday(today) - timedelta(weeks=1)
    billing_sunday = billing_monday + timedelta(days=6)
    # Рейсы за неделю — Python-side фильтрация статуса, потому что
    # SQLite LOWER() не поддерживает кириллицу:
    #   LOWER('Отменено') = 'Отменено'  (не 'отменено')
    # Python str.lower() работает корректно для любого Unicode.
    # dep_at — datetime; сравнение с date-объектом в SQLite дёт строки,
    # поэтому используем < следующего понедельника чтобы включить весь воскресный день.
    next_monday = billing_monday + timedelta(weeks=1)
    week_trips = session.exec(
        select(models.Trip).where(
            models.Trip.driver_id == user.driver_id,
            models.Trip.dep_at >= billing_monday,  # type: ignore[arg-type]
            models.Trip.dep_at < next_monday,       # type: ignore[arg-type]
        )
    ).all()

    last_week_trips = sum(
        1 for t in week_trips
        if not (t.status or "").lower().startswith("отмен")
    )
    last_week_cancelled = sum(
        1 for t in week_trips
        if (t.status or "").lower().startswith("отмен")
    )
    last_week_cancelled_fines = sum(
        float(t.fines or 0)
        for t in week_trips
        if (t.status or "").lower().startswith("отмен")
    )

    return {
        "driver_id": user.driver_id,
        "driver_name": user.full_name or user.username,
        "balance": balance,
        "as_of": as_of,
        "last_week_trips": last_week_trips,
        "last_week_cancelled": last_week_cancelled,
        "last_week_cancelled_fines": round(last_week_cancelled_fines, 2),
        "last_week_start": billing_monday,
    }


@router.post("/expense", status_code=201)
def driver_add_expense(
    payload: models.DriverExpenseCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Быстрый ввод расхода с мобильного дашборда водителя. Создаётся как
    обычный CashFlowEntry с category из DriverExpenseCreate - виден в реестре
    расходов (страница «Расходы»). driver_id берётся из токена, не из тела
    запроса - водитель не может подставить чужой driver_id.
    Статьи расходов = базовый список (EXPENSE_CATEGORIES): Ремонт/запчасти,
    Топливо, Зарплата, Страховка, Прочее. Состав уточним позднее (пользователь
    2026-06-30: "доступные статьи уточним позднее, сейчас бери базовые").
    """
    if not user.driver_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только водители могут добавлять расходы через этот маршрут",
        )

    entry = models.CashFlowEntry(
        date=payload.expense_date,
        expense=payload.amount,
        income=0,
        category=payload.category,
        purpose=payload.description,
        driver_id=user.driver_id,
        truck_id=None,
        status="ОПЛАЧЕНО",
        bank="",
        counterparty="",
        # period = "MM-YYYY" для сортировки в реестре расходов
        period=payload.expense_date.strftime("%m-%Y"),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {"id": entry.id, "ok": True}


@router.get("/weekly")
def driver_weekly(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Отчёт по неделям для иконки «документ» на балансе в мобильном дашборде.
    Агрегирует weekly_pnl по неделям водителя (суммирует по машинам внутри
    одной недели). Возвращает список строк в порядке убывания недели.
    Поля: week_start, week_end, trips, driver_payout, driver_paid, unpaid.
    """
    if not user.driver_id:
        return []

    today = date.today()
    settings = _get_settings(session)

    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()
    cash_flow_entries = session.exec(select(models.CashFlowEntry)).all()

    rows = weekly_pnl(trips, fuel_records, carriers, settings, None, today, driver_rates, cash_flow_entries)
    driver_rows = [r for r in rows if r.get("driver_id") == user.driver_id]

    # Агрегируем по неделям (суммируем payout/paid по разным машинам)
    agg: dict = defaultdict(lambda: {"driver_payout": 0.0, "driver_paid": 0.0, "week_end": None, "trips": 0})
    for r in driver_rows:
        wk = r["week_start"]
        agg[wk]["driver_payout"] += r["driver_payout"]
        agg[wk]["driver_paid"] += r["driver_paid"]
        agg[wk]["week_end"] = r["week_end"]

    # Рейсы водителя за каждую неделю — прямой счёт из таблицы Trip
    for t in trips:
        if t.driver_id != user.driver_id or not t.dep_at:
            continue
        wk = iso_week_monday(t.dep_at.date())
        if wk in agg:
            agg[wk]["trips"] += 1

    # Штрафы: CashFlowEntry категории "Штрафы" для этого водителя,
    # сгруппированные по ISO-неделе даты транзакции. (#147: SQL-фильтр)
    fines_rows = session.exec(
        select(models.CashFlowEntry.date, models.CashFlowEntry.expense).where(
            models.CashFlowEntry.driver_id == user.driver_id,
            models.CashFlowEntry.category == "Штрафы",
            models.CashFlowEntry.date.is_not(None),  # type: ignore[union-attr]
        )
    ).all()
    fines_by_week: dict = defaultdict(float)
    for cfe_date, cfe_expense in fines_rows:
        if cfe_date is not None:
            wk = iso_week_monday(cfe_date)
            if wk in agg:
                fines_by_week[wk] += cfe_expense

    result = []
    for wk in sorted(agg.keys(), reverse=True):
        d = agg[wk]
        unpaid = max(0.0, d["driver_payout"] - d["driver_paid"])
        result.append({
            "week_start": wk,
            "week_end": d["week_end"],
            "trips": d["trips"],
            "driver_payout": round(d["driver_payout"], 2),
            "driver_paid": round(d["driver_paid"], 2),
            "unpaid": round(unpaid, 2),
            "fines": round(fines_by_week.get(wk, 0.0), 2),
        })

    return result


@router.get("/profile")
def driver_profile(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Профиль водителя: ФИО, паспорт, права, СКЗИ и условия оплаты.
    Используется карточкой профиля в мобильном дашборде (клик по аватару).
    Водитель видит только свои данные — driver_id берётся из токена.
    """
    if not user.driver_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только водители могут просматривать профиль через этот маршрут",
        )

    driver = session.get(models.Driver, user.driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Водитель не найден")

    # Условия оплаты: DriverRate + имя перевозчика
    rates = session.exec(
        select(models.DriverRate).where(models.DriverRate.driver_id == user.driver_id)
    ).all()
    carriers = session.exec(select(models.Carrier)).all()
    carrier_map = {c.id: c.name for c in carriers}

    payment_terms = [
        {
            "carrier": carrier_map.get(r.carrier_id, f"Перевозчик #{r.carrier_id}"),
            "rate_type": r.rate_type,
            "rate_value": r.rate_value,
        }
        for r in rates
    ]

    return {
        "last_name":            driver.last_name or "",
        "first_name":           driver.first_name or "",
        "middle_name":          driver.middle_name or "",
        "passport_number":      driver.passport_number or "",
        "passport_issued_date": driver.passport_issued_date,
        "license_number":       driver.license_number or "",
        "license_issued_date":  driver.license_issued_date,
        "license_valid_until":  driver.license_valid_until,
        "skzi_card_number":     driver.skzi_card_number or "",
        "skzi_valid_until":     driver.skzi_valid_until,
        "payment_terms":        payment_terms,
    }


@router.get("/truck/{truck_id}")
def driver_truck_info(
    truck_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Сводка по машине для водителя: данные авто + документы (СТС, ОСАГО, ТехОсмотр).
    Доступно только если у водителя есть активная сессия с этой машиной.
    """
    # Проверяем, что эта машина сейчас у этого водителя
    active = session.exec(
        select(models.VehicleSession).where(
            models.VehicleSession.truck_id == truck_id,
            models.VehicleSession.ended_at == None,  # noqa: E711
        )
    ).first()
    # Водитель может смотреть только свою машину; admin/foreman — любую
    if user.role == "driver":
        if not active or active.driver_id != (user.driver_id or -1):
            raise HTTPException(status_code=403, detail="Нет доступа к этой машине")

    truck = session.get(models.Truck, truck_id)
    if not truck:
        raise HTTPException(status_code=404, detail="Машина не найдена")

    # Документы из таблицы Document (number stored in .notes)
    docs = session.exec(
        select(models.Document).where(models.Document.truck_id == truck_id)
    ).all()

    def _find_doc(doc_type: str) -> models.Document | None:
        # ищем по точному совпадению типа; "Техосмотр" == "Техосмотр"
        for d in docs:
            if d.type.lower().startswith(doc_type.lower()):
                return d
        return None

    osago_doc = _find_doc("ОСАГО")
    tech_doc  = _find_doc("Техосмотр")

    def _doc_block(number: str, date_val, doc: models.Document | None, scan_filename: str = ""):
        # Приоритет: Truck-поле (date_val) > Document.expiry_date
        d = date_val or (doc.expiry_date if doc else None)
        n = number or (doc.notes if doc else "") or ""
        # scan_path: полный URL /truck-scans/<filename>, или None если скана нет
        sp = f"/truck-scans/{scan_filename}" if scan_filename else None
        return {
            "number":    n,
            "date":      d.isoformat() if d else None,
            "scan_path": sp,
        }

    return {
        "plate":      truck.plate,
        "label":      truck.label,
        "brand":      truck.brand,
        "year":       truck.year,
        "body_type":  truck.body_type,
        "vin":        truck.vin,
        "sts":            _doc_block(truck.sts_number, truck.sts_date, None, truck.sts_scan or ""),
        "osago":          _doc_block(truck.osago_number or "", truck.osago_date, osago_doc, truck.osago_scan or ""),
        "tech_inspection": _doc_block(truck.tech_inspection_number or "", truck.tech_inspection_date, tech_doc, truck.tech_inspection_scan or ""),
    }


@router.get("/trips")
def driver_trips(
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Реестр рейсов водителя с расчётом выплаты за каждый рейс.
    Используется страницей DriverTrips.tsx (мобильный дашборд водителя).
    date_from/date_to — опциональный фильтр по dep_at.date().
    Колонки: source, request_number, dep_at, end_at, rate_type, driver_payout.
    Сортировка: dep_at DESC (свежие рейсы вверху).

    Расчёт driver_payout на уровне отдельного рейса:
      - percentOfNet / default: net * rate_value / 100
      - perTrip: rate_value (фиксированная сумма за рейс)
      - perKm / salary: fallback на DRIVER_PCT_PLACEHOLDER (нет поля km в Trip)
    """
    if not user.driver_id:
        return []

    settings = _get_settings(session)
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()

    all_trips = session.exec(
        select(models.Trip).where(models.Trip.driver_id == user.driver_id)
    ).all()

    # Фильтр по дате отгрузки
    filtered = [
        t for t in all_trips
        if t.dep_at is not None
        and (date_from is None or t.dep_at.date() >= date_from)
        and (date_to is None or t.dep_at.date() <= date_to)
    ]
    filtered.sort(key=lambda t: t.dep_at, reverse=True)

    result = []
    for t in filtered:
        commission_pct = commission_pct_for(t.carrier_name, carriers, settings)
        net = t.amount * (1 - commission_pct / 100)
        rate = driver_rate_for(user.driver_id, t.carrier_name, carriers, driver_rates)

        if rate and rate.rate_type == "perTrip":
            payout = round(rate.rate_value, 2)
            rate_type = "perTrip"
        elif rate and rate.rate_type == "percentOfNet":
            payout = round(net * rate.rate_value / 100, 2)
            rate_type = "percentOfNet"
        else:
            # perKm, salary, или DriverRate не задан — плейсхолдер
            payout = round(net * DRIVER_PCT_PLACEHOLDER / 100, 2)
            rate_type = rate.rate_type if rate else "fallback"

        result.append({
            "id": t.id,
            "source": t.source,
            "request_number": t.request_number,
            "status": t.status or "",
            "dep_at": t.dep_at,
            "end_at": t.end_at,
            "rate_type": rate_type,
            "driver_payout": payout,
            "fines": float(t.fines or 0),
        })

    return result
