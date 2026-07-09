"""Уровень 2/3 — тесты аутентификации и require_zone().

Проверяем:
- 401 без токена / с невалидным токеном
- 403 когда роль не имеет доступа к зоне (driver → carriers: can_read=False)
- 200 когда доступ разрешён (foreman → carriers: can_read=True)
- admin всегда проходит

Матрица по умолчанию (permissions.py DEFAULT_MATRIX):
  carriers / driver   → (False, False) → GET → 403
  carriers / foreman  → (True, False)  → GET → 200
  carriers / accountant → (True, True)
"""

import pytest
from sqlmodel import Session

from app import models
from app.auth import create_access_token, hash_password
from .conftest import make_user, token_headers


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _make_foreman(db) -> models.User:
    return make_user(db, "auth_test_foreman", "foreman")


def _make_driver(db) -> models.User:
    return make_user(db, "auth_test_driver", "driver")


def _make_accountant(db) -> models.User:
    return make_user(db, "auth_test_accountant", "accountant")


# ---------------------------------------------------------------------------
# 401 — без токена или с плохим токеном
# ---------------------------------------------------------------------------

class TestUnauthenticated:
    def test_no_token_returns_401(self, client):
        resp = client.get("/api/trips/")
        assert resp.status_code == 401

    def test_invalid_token_returns_401(self, client):
        resp = client.get(
            "/api/trips/",
            headers={"Authorization": "Bearer completely.invalid.token"},
        )
        assert resp.status_code == 401

    def test_malformed_bearer_returns_401(self, client):
        resp = client.get(
            "/api/trips/",
            headers={"Authorization": "NotBearer sometoken"},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# require_zone — доступ на чтение к зоне "carriers"
# carriers / driver   = (False, False) → 403
# carriers / foreman  = (True, False)  → 200
# carriers / admin    = always 200
# ---------------------------------------------------------------------------

class TestRequireZoneCarriers:
    def test_driver_cannot_read_carriers(self, client, db):
        driver = _make_driver(db)
        resp = client.get("/api/carriers/", headers=token_headers(driver))
        assert resp.status_code == 403

    def test_foreman_can_read_carriers(self, client, db):
        foreman = _make_foreman(db)
        resp = client.get("/api/carriers/", headers=token_headers(foreman))
        assert resp.status_code == 200

    def test_admin_can_read_carriers(self, client, admin_headers):
        resp = client.get("/api/carriers/", headers=admin_headers)
        assert resp.status_code == 200

    def test_foreman_cannot_write_carriers(self, client, db):
        """carriers / foreman = (True, False) → POST → 403."""
        foreman = _make_foreman(db)
        payload = {"name": "Test Carrier", "inn": "", "contact": ""}
        resp = client.post("/api/carriers/", json=payload, headers=token_headers(foreman))
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# require_zone — зона "trips"
# trips / driver  = (True, False)  → GET → 200 (own_filter_field дополнительно фильтрует)
# trips / foreman = (True, True)   → GET → 200
# ---------------------------------------------------------------------------

class TestRequireZoneTrips:
    def test_driver_can_read_trips(self, client, db):
        driver = _make_driver(db)
        resp = client.get("/api/trips/", headers=token_headers(driver))
        assert resp.status_code == 200

    def test_foreman_can_read_trips(self, client, db):
        foreman = _make_foreman(db)
        resp = client.get("/api/trips/", headers=token_headers(foreman))
        assert resp.status_code == 200

    def test_admin_can_read_trips(self, client, admin_headers):
        resp = client.get("/api/trips/", headers=admin_headers)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# admin-only зоны (require_role("admin"), не через конфигурируемую матрицу)
# ---------------------------------------------------------------------------

class TestAdminOnlyEndpoints:
    """Пользователи, Настройки, Роли — жёстко через require_role("admin")."""

    def test_foreman_cannot_access_users(self, client, db):
        foreman = _make_foreman(db)
        resp = client.get("/api/users/", headers=token_headers(foreman))
        assert resp.status_code == 403

    def test_driver_cannot_access_users(self, client, db):
        driver = _make_driver(db)
        resp = client.get("/api/users/", headers=token_headers(driver))
        assert resp.status_code == 403

    def test_admin_can_access_users(self, client, admin_headers):
        resp = client.get("/api/users/", headers=admin_headers)
        assert resp.status_code == 200
