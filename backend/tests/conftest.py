"""Общая конфигурация pytest для Transport CRM backend-тестов.

Использует SQLite in-memory (StaticPool) — изолировано от prod-БД.
Переопределяет get_session через dependency_override — все роутеры
используют тестовую БД прозрачно.

Запуск:
    cd PROD/backend
    pip install -r requirements-test.txt --break-system-packages
    pytest
"""

import os

# Должно быть ДО любых импортов app-модулей
os.environ.setdefault("JWT_SECRET", "pytest-test-secret-key-not-for-production-32chars")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password-pytest")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import models
from app.auth import create_access_token, hash_password, seed_default_admin
from app.database import get_session
from app.permissions import seed_default_role_permissions, upgrade_legacy_driver_defaults
from app.routers.expense_categories import seed_expense_categories
from app.main import app

# ---------------------------------------------------------------------------
# Тестовая БД: SQLite in-memory с StaticPool
# (все соединения видят одну и ту же базу)
# ---------------------------------------------------------------------------
_TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
SQLModel.metadata.create_all(_TEST_ENGINE)

# Сидируем тестовую БД один раз при загрузке модуля
with Session(_TEST_ENGINE) as _seed_session:
    seed_default_admin(_seed_session)
    seed_default_role_permissions(_seed_session)
    upgrade_legacy_driver_defaults(_seed_session)
    seed_expense_categories(_seed_session)


def _override_get_session():
    """Dependency override: все роутеры будут получать сессию тестовой БД."""
    with Session(_TEST_ENGINE) as s:
        yield s


app.dependency_overrides[get_session] = _override_get_session


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def client():
    """TestClient без context manager — lifespan не запускается.
    Сидирование выполнено вручную выше."""
    return TestClient(app)


@pytest.fixture(scope="session")
def db():
    """Прямой доступ к тестовому движку для setup/assert в тестах."""
    return _TEST_ENGINE


@pytest.fixture(scope="session")
def admin_user(db):
    with Session(db) as s:
        return s.exec(select(models.User).where(models.User.role == "admin")).first()


@pytest.fixture(scope="session")
def admin_headers(admin_user):
    token = create_access_token(admin_user.id, admin_user.username)
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Вспомогательные функции (не fixtures)
# ---------------------------------------------------------------------------

def make_user(
    db,
    username: str,
    role: str,
    driver_id: int | None = None,
) -> models.User:
    """Создаёт пользователя в тестовой БД (пропускает, если уже существует)."""
    with Session(db) as s:
        existing = s.exec(
            select(models.User).where(models.User.username == username)
        ).first()
        if existing:
            return existing
        user = models.User(
            username=username,
            password_hash=hash_password("testpass123"),
            role=role,
            full_name=f"Test {role}",
            is_active=True,
            driver_id=driver_id,
        )
        s.add(user)
        s.commit()
        s.refresh(user)
        return user


def token_headers(user: models.User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.username)}"}
