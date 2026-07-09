"""Уровень 3 — integration-тесты для заявок на компенсацию.

Проверяем полный цикл:
- водитель создаёт заявку → 201
- admin одобряет → 200, создаётся CashFlowEntry + DriverTransaction
- повторный approve → 409
- reject → статус "отказано", транзакции НЕ создаётся

Тесты используют TestClient + in-memory DB из conftest.py.
"""

import pytest
from sqlmodel import Session, select

from app import models
from app.auth import create_access_token, hash_password


# ---------------------------------------------------------------------------
# Фикстура: водитель с привязанным пользователем
# Возвращает (driver_id: int, auth_headers: dict) — только plain Python,
# чтобы избежать DetachedInstanceError после закрытия сессии.
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def driver_user(db):
    """Создаёт Driver-строку и User с role='driver' и driver_id.
    scope=module — переиспользуется во всех тестах файла.

    Возвращает (driver_id: int, headers: dict) — все значения извлекаются
    внутри сессии, чтобы не получить DetachedInstanceError снаружи.
    """
    with Session(db) as s:
        # --- Driver ---
        existing_d = s.exec(
            select(models.Driver).where(models.Driver.name == "CompTest Driver")
        ).first()
        if existing_d:
            driver_id: int = existing_d.id
        else:
            driver = models.Driver(name="CompTest Driver")
            s.add(driver)
            s.commit()
            s.refresh(driver)
            driver_id = driver.id

        # --- User ---
        existing_u = s.exec(
            select(models.User).where(models.User.username == "comp_test_driver")
        ).first()
        if existing_u:
            user_id: int = existing_u.id
            username: str = existing_u.username
        else:
            user = models.User(
                username="comp_test_driver",
                password_hash=hash_password("testpass123"),
                role="driver",
                full_name="CompTest Driver",
                is_active=True,
                driver_id=driver_id,
            )
            s.add(user)
            s.commit()
            s.refresh(user)
            user_id = user.id
            username = user.username

    # Создаём токен здесь — user больше не нужен как объект
    headers = {"Authorization": f"Bearer {create_access_token(user_id, username)}"}
    return driver_id, headers


def _make_request_payload(expense_date: str, amount: float, description: str) -> dict:
    return {
        "truck_id": None,
        "expense_date": expense_date,
        "amount": amount,
        "category": "Прочее",
        "description": description,
        "photo_paths": "",
    }


# ---------------------------------------------------------------------------
# Тесты
# ---------------------------------------------------------------------------

class TestCreateCompensationRequest:
    def test_driver_can_create_request(self, client, driver_user):
        _, headers = driver_user
        payload = _make_request_payload("2025-06-02", 1500.0, "Тест создания заявки")

        resp = client.post(
            "/api/compensation-requests/",
            json=payload,
            headers=headers,
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "на рассмотрении"
        assert data["amount"] == 1500.0

    def test_user_without_driver_id_cannot_create(self, client, db):
        """Пользователь без driver_id (например, accountant) получает 403."""
        with Session(db) as s:
            existing = s.exec(
                select(models.User).where(models.User.username == "comp_accountant_test")
            ).first()
            if existing:
                acc_id = existing.id
                acc_username = existing.username
            else:
                acc = models.User(
                    username="comp_accountant_test",
                    password_hash=hash_password("pass"),
                    role="accountant",
                    full_name="Accountant",
                    is_active=True,
                    driver_id=None,
                )
                s.add(acc)
                s.commit()
                s.refresh(acc)
                acc_id = acc.id
                acc_username = acc.username

        acc_headers = {"Authorization": f"Bearer {create_access_token(acc_id, acc_username)}"}
        payload = _make_request_payload("2025-06-02", 500.0, "Тест нет driver_id")
        resp = client.post(
            "/api/compensation-requests/",
            json=payload,
            headers=acc_headers,
        )
        assert resp.status_code == 403


class TestApproveCompensationRequest:
    def test_approve_returns_approved_status(self, client, driver_user, admin_headers):
        _, headers = driver_user
        payload = _make_request_payload("2025-06-10", 4000.0, "Тест approve статус")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        resp = client.post(
            f"/api/compensation-requests/{req_id}/approve",
            headers=admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["status"] == "принято"

    def test_approve_creates_cashflow_entry(self, client, driver_user, admin_headers, db):
        driver_id, headers = driver_user
        amount = 7777.0
        payload = _make_request_payload("2025-06-11", amount, "Тест cashflow entry")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        client.post(f"/api/compensation-requests/{req_id}/approve", headers=admin_headers)

        with Session(db) as s:
            entry = s.exec(
                select(models.CashFlowEntry).where(
                    models.CashFlowEntry.driver_id == driver_id,
                    models.CashFlowEntry.expense == amount,
                )
            ).first()
            entry_status = entry.status if entry else None

        assert entry is not None, "CashFlowEntry должен быть создан при approve"
        assert entry_status == "ОПЛАЧЕНО"

    def test_approve_creates_driver_transaction(self, client, driver_user, admin_headers, db):
        driver_id, headers = driver_user
        amount = 8888.0
        payload = _make_request_payload("2025-06-12", amount, "Тест driver transaction")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        client.post(f"/api/compensation-requests/{req_id}/approve", headers=admin_headers)

        with Session(db) as s:
            tx = s.exec(
                select(models.DriverTransaction).where(
                    models.DriverTransaction.driver_id == driver_id,
                    models.DriverTransaction.amount == amount,
                )
            ).first()
            tx_type = tx.tx_type if tx else None
            tx_ref_type = tx.ref_type if tx else None
            tx_ref_id = tx.ref_id if tx else None

        assert tx is not None, "DriverTransaction должен быть создан при approve"
        assert tx_type == "compensation"
        assert tx_ref_type == "compensation_request"
        assert tx_ref_id == req_id


class TestDoubleApprove:
    def test_second_approve_returns_409(self, client, driver_user, admin_headers):
        _, headers = driver_user
        payload = _make_request_payload("2025-06-13", 2000.0, "Тест 409 повторный approve")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        r1 = client.post(
            f"/api/compensation-requests/{req_id}/approve", headers=admin_headers
        )
        assert r1.status_code == 200

        r2 = client.post(
            f"/api/compensation-requests/{req_id}/approve", headers=admin_headers
        )
        assert r2.status_code == 409


class TestRejectCompensationRequest:
    def test_reject_sets_rejected_status(self, client, driver_user, admin_headers):
        _, headers = driver_user
        payload = _make_request_payload("2025-06-14", 3000.0, "Тест reject статус")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        resp = client.post(
            f"/api/compensation-requests/{req_id}/reject",
            json={"reason": "Нет документов"},
            headers=admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["status"] == "отказано"

    def test_reject_does_not_create_transaction(self, client, driver_user, admin_headers, db):
        driver_id, headers = driver_user
        payload = _make_request_payload("2025-06-15", 5000.0, "Тест reject нет транзакции")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        with Session(db) as s:
            count_before = len(
                s.exec(
                    select(models.DriverTransaction).where(
                        models.DriverTransaction.driver_id == driver_id
                    )
                ).all()
            )

        client.post(
            f"/api/compensation-requests/{req_id}/reject",
            json={"reason": "Отклонено тестом"},
            headers=admin_headers,
        )

        with Session(db) as s:
            count_after = len(
                s.exec(
                    select(models.DriverTransaction).where(
                        models.DriverTransaction.driver_id == driver_id
                    )
                ).all()
            )

        assert count_after == count_before, "reject не должен создавать DriverTransaction"

    def test_reject_after_approve_returns_409(self, client, driver_user, admin_headers):
        _, headers = driver_user
        payload = _make_request_payload("2025-06-16", 1000.0, "Тест reject после approve")
        req_id = client.post(
            "/api/compensation-requests/", json=payload, headers=headers
        ).json()["id"]

        client.post(f"/api/compensation-requests/{req_id}/approve", headers=admin_headers)

        resp = client.post(
            f"/api/compensation-requests/{req_id}/reject",
            json={"reason": "Поздно"},
            headers=admin_headers,
        )
        assert resp.status_code == 409


class TestPendingCount:
    def test_pending_count_increases_after_create(self, client, driver_user, admin_headers):
        _, headers = driver_user

        before = client.get(
            "/api/compensation-requests/pending-count/", headers=admin_headers
        ).json()["count"]

        client.post(
            "/api/compensation-requests/",
            json=_make_request_payload("2025-06-20", 100.0, "Тест счётчик"),
            headers=headers,
        )

        after = client.get(
            "/api/compensation-requests/pending-count/", headers=admin_headers
        ).json()["count"]

        assert after == before + 1
