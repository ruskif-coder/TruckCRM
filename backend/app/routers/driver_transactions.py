"""Журнал транзакций водителя (2026-07-05).

Хранит корректировки баланса водителя, не охваченные weekly_pnl:
  - compensation  (одобренная заявка на компенсацию, создаётся автоматически)
  - fine_pdd      (штраф ПДД — ручной ввод admin/foreman/accountant)
  - fine_company  (штраф от компании — ручной ввод с обязательной причиной)
  - advance       (аванс — ручной ввод admin/foreman/accountant)

Базовый баланс (начисления за рейсы и выплаты) считается через weekly_pnl()
и живёт в /api/driver-dashboard/summary. DriverTransaction хранит только
дополнительные корректировки поверх этого базового баланса.

Пути:
  GET  /api/driver-transactions/balances — полный баланс всех водителей (staff)
  GET  /api/driver-transactions/         — список транзакций + сумма корректировок
  POST /api/driver-transactions/         — создать корректировку (admin/foreman/accountant)
"""
import logging
from datetime import date as _date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user
from ..calculations import weekly_pnl as _weekly_pnl
from ..database import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/driver-transactions", tags=["driver-transactions"])

_STAFF_ROLES = {"admin", "foreman", "accountant"}

# Типы, создаваемые вручную через этот эндпойнт (остальные — системные)
_MANUAL_TYPES = {"advance", "fine_pdd", "fine_company", "payout", "bonus"}

# Типы, для которых amount хранится как отрицательное (удержание/выплата)
_DEBIT_TYPES = {"advance", "fine_pdd", "fine_company", "payout"}


def _require_staff(user: models.User) -> None:
    if user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Доступ только для admin/foreman/accountant")


@router.get("/balances")
def all_driver_balances(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Полный баланс каждого водителя: weekly_pnl_unpaid + SUM(DriverTransaction).
    Staff only. Используется в Drivers.tsx для отображения баланса в строке.
    """
    _require_staff(user)

    today = _date.today()
    settings = session.get(models.Settings, 1) or models.Settings(id=1)
    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()
    cash_flow = session.exec(select(models.CashFlowEntry)).all()

    # Незакрытые выплаты по неделям (базовый баланс)
    pnl_rows = _weekly_pnl(trips, fuel_records, carriers, settings, None, today, driver_rates, cash_flow)
    unpaid_map: dict[int, float] = {}
    for r in pnl_rows:
        did = r.get("driver_id")
        if not did:
            continue
        unpaid = max(0.0, (r.get("driver_payout") or 0.0) - (r.get("driver_paid") or 0.0))
        unpaid_map[did] = unpaid_map.get(did, 0.0) + unpaid

    # Корректировки из DriverTransaction (GROUP BY driver_id)
    tx_rows = session.exec(
        select(
            models.DriverTransaction.driver_id,
            func.sum(models.DriverTransaction.amount).label("total"),
        ).group_by(models.DriverTransaction.driver_id)
    ).all()
    tx_map = {r.driver_id: float(r.total or 0.0) for r in tx_rows}

    all_ids = set(unpaid_map) | set(tx_map)
    return [
        {
            "driver_id": did,
            "balance": round(unpaid_map.get(did, 0.0) + tx_map.get(did, 0.0), 2),
        }
        for did in all_ids
    ]


@router.get("/full-ledger")
def full_ledger(
    driver_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Полная выписка: начисления/выплаты из weekly_pnl + ручные корректировки.

    Водитель — видит только свои записи (driver_id берётся из токена).
    Staff (admin/foreman/accountant) — обязан передать driver_id как query-параметр.
    """
    if user.role == "driver":
        # Чистый водитель — берём driver_id из токена
        target_id = user.driver_id
        logger.info("[full-ledger] role=driver user.id=%s user.driver_id=%s", user.id, user.driver_id)
        if not target_id:
            logger.warning("[full-ledger] driver user.id=%s has no driver_id — returning []", user.id)
            return []
    elif user.driver_id and not driver_id:
        # Бригадир/другая роль, который ТАКЖЕ является водителем
        # и обращается без query param → показываем его собственную выписку
        target_id = user.driver_id
        logger.info("[full-ledger] role=%s with own driver_id=%s", user.role, user.driver_id)
    else:
        # Staff смотрит выписку конкретного водителя через query param
        _require_staff(user)
        if not driver_id:
            return []
        target_id = driver_id

    today = _date.today()
    settings = session.get(models.Settings, 1) or models.Settings(id=1)
    trips = session.exec(select(models.Trip)).all()
    fuel_records = session.exec(select(models.FuelRecord)).all()
    carriers = session.exec(select(models.Carrier)).all()
    driver_rates = session.exec(select(models.DriverRate)).all()
    cash_flow = session.exec(select(models.CashFlowEntry)).all()

    pnl_rows = _weekly_pnl(trips, fuel_records, carriers, settings, None, today, driver_rates, cash_flow)

    entries = []

    for r in pnl_rows:
        if r.get("driver_id") != target_id:
            continue
        week_end = str(r.get("week_end") or "")
        payout = round(float(r.get("driver_payout") or 0.0), 2)
        paid = round(float(r.get("driver_paid") or 0.0), 2)
        if payout:
            entries.append({
                "date": week_end,
                "entry_type": "pnl_accrual",
                "amount": payout,
                "description": f"Начисление за неделю до {week_end}",
            })
        if paid:
            entries.append({
                "date": week_end,
                "entry_type": "pnl_payment",
                "amount": -paid,
                "description": f"Выплата за неделю до {week_end}",
            })

    txs = session.exec(
        select(models.DriverTransaction)
        .where(models.DriverTransaction.driver_id == target_id)
        .order_by(
            models.DriverTransaction.date.desc(),
            models.DriverTransaction.id.desc(),
        )
    ).all()
    for tx in txs:
        entries.append({
            "date": str(tx.date),
            "entry_type": tx.tx_type,
            "amount": tx.amount,
            "description": tx.description or "",
        })

    entries.sort(key=lambda x: x["date"], reverse=True)
    logger.info("[full-ledger] target_id=%s → %d entries (%d tx)", target_id, len(entries), len(txs))
    return entries


@router.get("/")
def list_transactions(
    driver_id: Optional[int] = Query(default=None),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Список транзакций и суммарная корректировка баланса водителя.

    Водитель видит только свои транзакции (driver_id из токена).
    Staff может передать driver_id как query-параметр.

    Возвращает:
      balance_adjustment — SUM(amount) по всем транзакциям (прибавляется к weekly_pnl-балансу)
      transactions       — список транзакций, новые сначала
    """
    if user.role == "driver":
        target_id = user.driver_id
        if not target_id:
            return {"balance_adjustment": 0.0, "transactions": []}
    elif user.driver_id and not driver_id:
        # Бригадир/другая роль, который ТАКЖЕ является водителем — его собственные транзакции
        target_id = user.driver_id
    else:
        _require_staff(user)
        target_id = driver_id
        if not target_id:
            return {"balance_adjustment": 0.0, "transactions": []}

    txs = session.exec(
        select(models.DriverTransaction)
        .where(models.DriverTransaction.driver_id == target_id)
        .order_by(
            models.DriverTransaction.date.desc(),
            models.DriverTransaction.id.desc(),
        )
    ).all()

    total = sum(tx.amount for tx in txs)
    return {
        "balance_adjustment": round(total, 2),
        "transactions": [tx.model_dump() for tx in txs],
    }


@router.post("/", status_code=201)
def create_transaction(
    payload: models.DriverTransactionCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Ручная корректировка баланса водителя.

    Доступно admin / foreman / accountant.
    Разрешённые типы: advance (аванс), fine_pdd (штраф ПДД), fine_company (штраф от компании).
    amount — положительное число; сервер сохраняет его как отрицательное (удержание).

    Для fine_company поле description обязательно.
    """
    _require_staff(user)

    if payload.tx_type not in _MANUAL_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый тип '{payload.tx_type}'. Разрешено: {sorted(_MANUAL_TYPES)}",
        )

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="amount должен быть > 0")

    if payload.tx_type == "fine_company" and not (payload.description or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Для штрафа от компании обязателен комментарий (description)",
        )

    # Debit-типы хранятся как отрицательные: уменьшают баланс водителя
    signed_amount = -abs(payload.amount) if payload.tx_type in _DEBIT_TYPES else payload.amount

    tx = models.DriverTransaction(
        driver_id=payload.driver_id,
        date=payload.date,
        tx_type=payload.tx_type,
        amount=signed_amount,
        description=(payload.description or "").strip(),
        ref_type="",
        ref_id=None,
        created_by_user_id=user.id,
    )
    session.add(tx)

    # Штраф ПДД = компания заплатила за водителя → автоматически фиксируем расход в кассе
    if payload.tx_type == "fine_pdd":
        driver = session.get(models.Driver, payload.driver_id)
        driver_name = driver.name if driver else f"водитель #{payload.driver_id}"
        desc = (payload.description or "").strip()
        purpose = f"Штраф ПДД — {driver_name}"
        if desc:
            purpose = f"{purpose}: {desc}"
        cash_entry = models.CashFlowEntry(
            date=payload.date,
            expense=payload.amount,  # payload.amount всегда > 0
            income=0.0,
            category="Штрафы",
            purpose=purpose,
            driver_id=payload.driver_id,
            truck_id=None,
            status="ОПЛАЧЕНО",
            bank="",
            counterparty="",
            period=payload.date.strftime("%m-%Y"),
        )
        session.add(cash_entry)

    # Выплата водителю → фиксируем расход в реестре расходов (статья "Расчёт с водителем")
    if payload.tx_type == "payout":
        driver = session.get(models.Driver, payload.driver_id)
        driver_name = driver.name if driver else f"водитель #{payload.driver_id}"
        desc = (payload.description or "").strip()
        purpose = f"Расчёт с водителем — {driver_name}"
        if desc:
            purpose = f"{purpose}: {desc}"
        cash_entry = models.CashFlowEntry(
            date=payload.date,
            expense=payload.amount,
            income=0.0,
            category="Расчёт с водителем",
            purpose=purpose,
            driver_id=payload.driver_id,
            truck_id=None,
            status="ОПЛАЧЕНО",
            bank="",
            counterparty="",
            period=payload.date.strftime("%m-%Y"),
        )
        session.add(cash_entry)

    session.commit()
    session.refresh(tx)
    return tx
