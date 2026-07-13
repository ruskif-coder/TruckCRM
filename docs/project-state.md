# Transport CRM — состояние проекта

_Последнее обновление: 2026-07-13_

## Что это за проект

FastAPI + SQLModel + SQLite бэкенд, React 18 + TypeScript + Vite → nginx фронтенд. Docker Compose. Транспортная CRM для небольшой компании.

Папка на устройстве пользователя: `D:\Dropbox\Transport CRM\PROD\`  
Устройство: **skif-rtx**  
Домен для деплоя: **pm.simbad.pro**  
IP сервера: **135.106.163.58**  
GitHub: **https://github.com/ruskif-coder/TruckCRM** (приватный, ветка `main`)

---

## Сервер (Ubuntu)

- Пользователь: `root`
- Папка проекта: `/root/truckcrm/`
- Папка finance-проекта: `/root/finance/`
- Caddy: контейнер `finance_caddy`, Caddyfile: `/root/finance/Caddyfile`
- Общая сеть для Caddy: `caddy_proxy` (внешняя Docker-сеть)

### Контейнеры TruckCRM на сервере

| Контейнер | Описание |
|---|---|
| `truckcrm-backend-1` | FastAPI, порт не проброшен наружу |
| `truckcrm-frontend` | nginx, на сети `caddy_proxy` |
| `truckcrm-backup-1` | ежедневный бэкап в 03:00 UTC |

### docker-compose.override.yml на сервере (не в git)
```yaml
services:
  frontend:
    container_name: truckcrm-frontend
    networks:
      - default
      - caddy_proxy
    ports: !reset []

  backend:
    ports: !reset []

networks:
  caddy_proxy:
    external: true
```

---

## Архитектура

- **Бэкенд**: FastAPI + SQLModel + SQLite (WAL-режим), порт 8000
- **Фронтенд**: React 18 + TypeScript + Vite, собирается в nginx, порт 3000 (внешний) → 80 (внутри контейнера)
- **nginx внутри фронтенд-контейнера**: проксирует `/api/` на `backend:8000`; `/photos/` и `/truck-scans/` убраны (теперь через `/api/files/`)
- **API_URL**: пустая строка (`""`) → браузер использует относительные URL → nginx проксирует на нужный бэкенд
- **БД**: SQLite, файл `./data/db/transport_crm.db`, монтируется как volume
- **Бэкап**: отдельный alpine-контейнер, ежедневно в 03:00 UTC, ротация 7 дней, `./data/backups/`
- **Caddy** на сервере как внешний reverse proxy, автоматический HTTPS

---

## Окружения (локально)

| | PROD | STAGING |
|---|---|---|
| Compose-файл | `docker-compose.yml` | `docker-compose.staging.yml` |
| Порт фронтенда | 3000 | 81 |
| Порт бэкенда | 8000 | 8001 |
| Данные | `./data/` | `./data_staging/` |
| ENV-файл | `.env` | `.env.staging` |

Управление через `crm.bat`.

---

## Безопасность / git

- `.env`, `.env.staging`, `data/`, `data_staging/` — НЕ в git
- `styles.css`, `index.css` — **НЕ в git** (нужны для сборки; хранятся только локально и на сервере)
- Никаких реальных данных в коде нет
- CORS на сервере: `CORS_ORIGINS=https://pm.simbad.pro` в `.env`
- Порт 8000 бэкенда **не пробрасывается** в `docker-compose.yml` (только в `docker-compose.dev.yml`)

### Защищённые файлы (фото / сканы)
`/photos/` и `/truck-scans/` убраны из публичного nginx. Вместо них — JWT-защищённые эндпоинты:
- `GET /api/files/photos/{filename}?token=<jwt>`
- `GET /api/files/truck-scans/{filename}?token=<jwt>`

Хелпер `fileUrl(path)` в `frontend/src/api.ts` автоматически добавляет `?token=`. Используется везде, где нужна ссылка на файл (`<img src>`, `<a href>`).

---

## Рабочий процесс — разработка и деплой

**Всегда через git. Claude читает актуальные файлы с устройства через device_stage_files, вносит правки, записывает обратно через device_commit_files.**

### ⚠️ Важно: всегда брать файлы с устройства
Claude должен СНАЧАЛА стянуть файл с устройства (`device_stage_files`), потом вносить правки — иначе workspace может содержать устаревшую версию.

### Стандартный цикл:
1. Claude стягивает файл с устройства через `device_stage_files`
2. Вносит правки в стянутую копию
3. Записывает обратно через `device_commit_files`
4. Пользователь делает `git add / commit / push` (опция 10 в crm.bat)
5. На сервере `git pull` + пересборка

### Команды деплоя на сервере:
```bash
cd /root/truckcrm && git pull
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build -d

# Только фронтенд
docker compose -f docker-compose.yml -f docker-compose.override.yml up --build -d frontend

# Только бэкенд (только перезапуск, без пересборки)
docker compose -f docker-compose.yml -f docker-compose.override.yml restart backend

# Логи
docker compose -f docker-compose.yml -f docker-compose.override.yml logs -f
```

### Версионирование:
- Версия хранится в `frontend/src/version.ts` и `frontend/package.json`
- Отображается в Настройки → Профиль → «О системе»
- Патч: третья цифра (1.1.3 → 1.1.4), фича: вторая (1.1.x → 1.2.0)
- Текущая версия: **1.1.4**

---

## Перенос данных

### БД с локальной машины на сервер
```bat
scp "D:\Dropbox\Transport CRM\PROD\data\backups\<файл>.db" root@135.106.163.58:/root/truckcrm/data/db/transport_crm.db
```
После переноса:
```bash
chmod 666 /root/truckcrm/data/db/transport_crm.db
chmod 666 /root/truckcrm/data/db/transport_crm.db-shm
chmod 666 /root/truckcrm/data/db/transport_crm.db-wal
```

### Фото и сканы
```bat
scp -r "D:\Dropbox\Transport CRM\PROD\data\photos" root@135.106.163.58:/root/truckcrm/data/
scp -r "D:\Dropbox\Transport CRM\PROD\data\truck_scans" root@135.106.163.58:/root/truckcrm/data/
```

---

## Caddyfile — итоговое состояние

Использовать точные имена контейнеров (не алиасы сети):

```
pm.simbad.pro {
    encode gzip
    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }
    reverse_proxy truckcrm-frontend:80
}
```

---

## БД

- SQLite + WAL-режим
- Переход на PostgreSQL заготовлен в `docker-compose.yml` (закомментировано)
- Бэкапы: `/root/truckcrm/data/backups/`, ротация 7 дней

---

## Пароли / секреты

Сброс пароля:
```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml exec backend python reset_admin.py --username ЛОГИН --password 'ПАРОЛЬ'
```

---

## CSS — важно

`styles.css` и `index.css` **не в git-репо**. Хранятся только локально и монтируются при сборке.

### Дизайн-система (ключевые токены)
- `--iris`: #5683da — основной акцент (синий)
- `--ember`: оранжевый акцент
- `.input` border-radius: 10px; `.pill-btn` border-radius: 9999px; `.fcard` border-radius: var(--r-card) = 26px
- MultiSelect trigger: border-radius 10px; активная = синяя заливка (`var(--iris)`)
- Кнопки-переключатели в фильтрах: pill, синие когда активны

---

## ⚠️ Известные грабли

**SQLite LOWER() не поддерживает кириллицу** — фильтровать через Python `str.lower()`, не через SQL.

**docker compose restart backend ≠ пересборка** — для применения кода нужен `up --build -d`.

**Dropbox sync может перезаписать правки** — перед сессией брать файл заново через `device_stage_files`.

**git index.lock на Windows** — удалять вручную:
```powershell
Remove-Item "D:\Dropbox\Transport CRM\PROD\.git\HEAD.lock" -Force
Remove-Item "D:\Dropbox\Transport CRM\PROD\.git\index.lock" -Force
```
После чего git-команды выполнять в обычном cmd, переключившись: `D:` → `cd "Dropbox\Transport CRM\PROD"`.

---

## Модели данных (ключевые)

### DriverTransaction

```python
# Типы транзакций:
# compensation  — компенсация (авто, из заявок)
# advance       — аванс (ручной, отрицательный)
# fine_pdd      — штраф ПДД (ручной, отрицательный; автоматически создаёт CashFlowEntry)
# fine_company  — штраф от компании (ручной, отрицательный, требует description)
# payout        — выплата водителю (ручной, отрицательный)

_MANUAL_TYPES = {"advance", "fine_pdd", "fine_company", "payout"}
_DEBIT_TYPES  = {"advance", "fine_pdd", "fine_company", "payout"}
```

**Баланс водителя** = `Σ max(0, driver_payout - driver_paid) по неделям` + `Σ DriverTransaction.amount`

API:
- `GET /api/driver-transactions/balances` — все балансы (staff only)
- `GET /api/driver-transactions/full-ledger?driver_id=` — полная выписка

### PayoutModal (`frontend/src/components/PayoutModal.tsx`)
Модалка «Выплатить водителю». Создаёт DriverTransaction типа `payout`.  
Подключена в `Drivers.tsx`: кнопка «Выплата» в строке водителя и в шапке панели выписки.

### Counterparty
```python
class Counterparty(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    inn: str = ""
    vat_rate: float = 0
```
Пустой `inn` → красная подсветка в Справочниках. `vat_rate` автоподтягивается в Финансах.

### Carrier balance
```
gross   = Σ trip.amount   (не отменённые рейсы)
fines   = Σ trip.fines    (ВСЕ рейсы, включая отменённые)
net     = (gross - fines) × (1 - carrier.insurance_pct / 100)
paid    = Σ CashFlowEntry.income где counterparty = carrier.counterparty.name
balance = Σ net_week - paid
```

---

## История версий

### ✅ v1.1.4 — задеплоено (2026-07-13)
- Безопасность: фото и сканы защищены JWT (`/api/files/...?token=`)
- Безопасность: порт 8000 убран из prod docker-compose
- Биллинг: убрана кнопка «Закрыть выплату», убрана цветовая индикация (Reports → Водители)
- Биллинг: колонка «Баланс» в Reports → Водители
- Новый тип DriverTransaction `payout` — фиксирует выплату водителю
- `PayoutModal.tsx` + кнопка «Выплата» в Drivers.tsx
- `fileUrl()` хелпер, обновлены все ссылки на файлы

### ✅ v1.1.3 — задеплоено (2026-07-12)
- `carrier_balance.py` — формула net=(gross-fines)×(1-sk%)
- Counterparty модель
- Reports → вкладка баланс перевозчиков
- Expenses → переименован в **Финансы**; CounterpartyCombobox; карточка «Долг перевозчиков»
- Directories → вкладка «Контрагенты»
- Dashboard → виджет «Денежный поток»
