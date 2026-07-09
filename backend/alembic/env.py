"""Alembic migration environment — Transport CRM.

Ключевые решения:
- DATABASE_URL берётся из переменной окружения (как в app/database.py),
  поэтому alembic работает с той же БД, что и FastAPI.
- render_as_batch=True для SQLite: SQLite не поддерживает ALTER TABLE
  напрямую; Alembic использует временную таблицу + COPY для ALTER TABLE.
  Для PostgreSQL batch-режим отключается автоматически.
- target_metadata = SQLModel.metadata: autogenerate сравнивает модели
  (models.py) с реальной схемой БД.

Создание новой миграции после изменения models.py:
  alembic revision --autogenerate -m "краткое_описание"
  # Проверь сгенерированный файл перед применением!
  alembic upgrade head
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

# Импорт всех моделей, чтобы их метаданные попали в SQLModel.metadata.
# Без этого autogenerate не "видит" таблицы и не сможет сгенерировать diff.
from app import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Целевая схема для autogenerate — всё, что описано через SQLModel/SQLAlchemy.
target_metadata = SQLModel.metadata

# DATABASE_URL из окружения (тот же приоритет, что в app/database.py).
# Если переменная не задана — SQLite в текущей директории (только для dev).
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./transport_crm.db")
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# SQLite: ALTER TABLE требует batch-режима (Alembic создаёт временную таблицу).
# PostgreSQL: батч не нужен (полный DDL поддерживается).
_is_sqlite = DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    """Offline-режим: генерирует SQL без подключения к БД.
    Используется для ревью миграций: alembic upgrade head --sql
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=_is_sqlite,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Online-режим: подключается к реальной БД и применяет миграции."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # check_same_thread=False нужен только для SQLite в многопоточных средах.
        connect_args={"check_same_thread": False} if _is_sqlite else {},
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=_is_sqlite,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
