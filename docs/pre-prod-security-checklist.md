# Чеклист тестирования перед выходом в прод
## Transport CRM — FastAPI + React + SQLite + Docker

> Стек: FastAPI, SQLModel, SQLite, React 18, TypeScript, JWT, bcrypt, nginx, Docker Compose

---

## 1. Функциональное smoke-тестирование

Минимальный набор — каждый раз перед деплоем.

| Сценарий | Ожидаемый результат |
|---|---|
| Логин admin → переход на `/` | Открывается дашборд |
| Логин водитель → переход на `/driver` | Открывается мобильный кабинет |
| Логин бригадир → переход на `/foreman` | Открывается кабинет бригадира |
| Логин с неверным паролем | 401, сообщение без уточнения что именно неверно |
| Открыть `/settings` как менеджер | Редирект или 403 |
| Открыть `/` без токена | Редирект на `/login` |
| Создать рейс → появился в реестре | 201, данные сохранились |
| Водитель открывает рейсы чужого водителя | Пустой список или 403 |

---

## 2. Аутентификация и авторизация

### 2.1 JWT-токены

```bash
# Получить токен
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -d "username=admin&password=ВАШ_ПАРОЛЬ" | jq -r .access_token)

# Проверить что без токена возвращается 401
curl -s http://localhost:8000/api/trips/ | jq .status_code
# Ожидание: 401

# Попробовать поддельный токен
curl -s -H "Authorization: Bearer fake.token.here" \
  http://localhost:8000/api/trips/
# Ожидание: 401
```

**Что проверить:**
- `alg: none` атака — подделка JWT без подписи
  ```
  Header: {"alg":"none","typ":"JWT"}
  # Ожидание: 401 (FastAPI jose проверяет алгоритм)
  ```
- Истёкший токен — изменить `exp` в payload и проверить, что не принимается
- Токен другого пользователя — взять токен водителя, попробовать запросить `/api/users/`
- `kid` injection — если в заголовке токена подставить другой `kid`

### 2.2 Ролевая матрица (критично)

```bash
DRIVER_TOKEN="..."   # токен роли driver
FOREMAN_TOKEN="..."  # токен роли foreman

# Водитель не должен видеть /api/users/
curl -H "Authorization: Bearer $DRIVER_TOKEN" \
  http://localhost:8000/api/users/
# Ожидание: 403

# Водитель не должен видеть чужие расходы
curl -H "Authorization: Bearer $DRIVER_TOKEN" \
  "http://localhost:8000/api/cash-flow/?driver_id=999"
# Ожидание: только свои данные (own_filter_field)

# Бригадир не должен попасть в /api/role-permissions/
curl -H "Authorization: Bearer $FOREMAN_TOKEN" \
  http://localhost:8000/api/role-permissions/
# Ожидание: 403

# Менеджер не должен попасть в /api/users/
curl -H "Authorization: Bearer $MANAGER_TOKEN" \
  http://localhost:8000/api/users/
# Ожидание: 403
```

### 2.3 Горизонтальная привилегия (IDOR)

Водитель пытается получить данные другого водителя, зная его ID:
```bash
# Водитель ID=5 пытается прочитать транзакции водителя ID=3
curl -H "Authorization: Bearer $DRIVER_TOKEN" \
  "http://localhost:8000/api/driver-transactions/?driver_id=3"
# Ожидание: только свои данные

# Пытается прочитать чужой акт приёмки по ID
curl -H "Authorization: Bearer $DRIVER_TOKEN" \
  "http://localhost:8000/api/vehicle-inspections/42"
# Ожидание: 403 или пустой ответ
```

---

## 3. Инъекции и валидация входных данных

### 3.1 SQL-инъекция

FastAPI + SQLModel используют параметризованные запросы — прямых инъекций быть не должно, но проверить:

```bash
# В строках поиска/фильтрации
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/trips/?search='; DROP TABLE trip; --"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/drivers/?q=1' OR '1'='1"

# Ожидание: пустой список или корректный ответ, таблицы целы
```

Проверка целостности после тестов: список водителей и рейсов должен остаться прежним.

### 3.2 XSS (Cross-Site Scripting)

Создать запись с XSS-нагрузкой в текстовых полях:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8000/api/drivers/ \
  -d '{"name": "<script>alert(1)</script>", "phone": "test"}'
```

- API должен принять как обычную строку (экранирование на уровне React — `{value}` в JSX)
- Убедиться, что React рендерит как текст, а не как HTML
- Проверить поля примечаний в инспекциях, комментарии к ремонту

### 3.3 Path Traversal (обход директорий)

Эндпоинты фото отдают файлы по имени:
```bash
# Попытка выйти из папки photos
curl "http://localhost/photos/../../../etc/passwd"
curl "http://localhost/photos/..%2F..%2Fetc%2Fpasswd"
curl "http://localhost/truck-scans/../../../../etc/shadow"

# Ожидание: 400 или 404, файл /etc/passwd не вернуть
```

nginx должен блокировать `..` в пути. Проверить конфиг:
```nginx
# В nginx.conf должно быть:
location /photos/ {
    alias /photos/;
    # Без autoindex!
}
```

### 3.4 Загрузка файлов (File Upload)

```bash
# Попытка загрузить .php / .py вместо изображения
curl -X POST -H "Authorization: Bearer $DRIVER_TOKEN" \
  -F "file=@shell.php;type=image/jpeg" \
  http://localhost:8000/api/vehicle-inspections/photo

# Попытка загрузить SVG с JS
curl -X POST -H "Authorization: Bearer $DRIVER_TOKEN" \
  -F "file=@evil.svg;type=image/svg+xml" \
  http://localhost:8000/api/vehicle-inspections/photo
```

**Что должно быть в backend:**
- Проверка MIME-типа через Pillow (PIL.Image.open) — уже есть
- Проверка расширения файла
- UUID-переименование при сохранении — уже есть
- Максимальный размер файла

### 3.5 Mass Assignment

Попытка выставить поле `role` при обновлении профиля:
```bash
curl -X PUT -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8000/api/auth/me" \
  -d '{"role": "admin", "is_active": true}'

# Ожидание: 403 или поле role проигнорировано
```

---

## 4. Брутфорс и rate limiting

### 4.1 Логин

```bash
# 11 запросов подряд (лимит 10/мин через slowapi)
for i in $(seq 1 15); do
  curl -s -X POST http://localhost:8000/api/auth/login \
    -d "username=admin&password=wrong$i" \
    -w "HTTP %{http_code}\n" -o /dev/null
done
# Первые 10: 401, начиная с 11-го: 429 Too Many Requests
```

### 4.2 Перебор reset-токенов

```bash
# POST /api/auth/request-reset тоже под лимитом (5/мин)
for i in $(seq 1 8); do
  curl -s -X POST http://localhost:8000/api/auth/request-reset \
    -H "Content-Type: application/json" \
    -d '{"email": "test@test.com"}' \
    -w "HTTP %{http_code}\n" -o /dev/null
done
# После 5-го: 429
```

### 4.3 Перебор UUID-токена сброса пароля

UUID токен = 36 символов, 2^122 вариантов — перебор нереален. Но проверить:
- Токен одноразовый (`used=True` после применения)
- Токен истекает через 1 час (`expires_at`)
- Старые токены удаляются при новом запросе (#148)

---

## 5. Заголовки безопасности HTTP

```bash
curl -I http://localhost/

# Проверить наличие:
# X-Content-Type-Options: nosniff
# X-Frame-Options: DENY  (или SAMEORIGIN)
# Content-Security-Policy: ...
# Strict-Transport-Security: ... (только если HTTPS)
# Referrer-Policy: no-referrer

# Проверить отсутствие лишнего:
# Server: nginx/1.27 — версию лучше скрыть
```

Добавить в `nginx.conf`:
```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" always;
server_tokens off;  # скрыть версию nginx
```

---

## 6. CORS

```bash
# Проверить что посторонний домен отклоняется
curl -H "Origin: https://evil.com" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/trips/ -v 2>&1 | grep -i "access-control"

# Если CORS_ORIGINS=* — это проблема в prod!
# Должно быть: CORS_ORIGINS=https://ваш-домен.ru
```

**Важно:** текущий `CORS_ORIGINS=*` в docker-compose.yml необходимо изменить перед выходом в прод.

---

## 7. Информационное раскрытие

### 7.1 Стек-трейсы в ответах

```bash
# Вызвать ошибку — передать неверный тип
curl -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/api/trips/ \
  -d '{"dep_at": "not-a-date", "driver_id": "abc"}'

# Ожидание: 422 Unprocessable Entity с описанием полей
# НЕ должно быть: traceback Python, пути к файлам, версия библиотек
```

### 7.2 Swagger/ReDoc в prod

```bash
curl http://localhost:8000/docs
curl http://localhost:8000/redoc
curl http://localhost:8000/openapi.json
```

В проде лучше закрыть или ограничить по IP:
```python
# main.py
app = FastAPI(docs_url=None, redoc_url=None)  # полностью закрыть
# ИЛИ оставить для внутренней сети
```

### 7.3 Заголовок Server

```bash
curl -I http://localhost:8000/ | grep -i server
# Не должно быть: "uvicorn" с версией
```

---

## 8. Безопасность инфраструктуры

### 8.1 Открытые порты

```bash
# На prod-сервере должен быть открыт только 80/443
nmap -p- localhost
# Ожидание: только 80 (и 443 если HTTPS)
# НЕ должен быть виден: 8000 (backend) напрямую
```

Порт 8000 должен быть доступен только через nginx-прокси, не снаружи.

### 8.2 Docker

```bash
# Проверить что контейнеры не запущены от root
docker exec crm-backend-1 whoami
# Ожидание: не root (добавить USER в Dockerfile)

# Проверить что volume с БД не доступен другим контейнерам
docker inspect crm-backend-1 | grep -A5 Mounts

# Проверить переменные окружения контейнера
docker inspect crm-backend-1 | grep -A20 Env
# НЕ должно быть: токенов, паролей в plaintext (они есть через .env — ок)
```

### 8.3 SQLite WAL и права доступа

```bash
# Файл БД не должен быть читаем всеми
ls -la PROD/data/db/transport_crm.db
# Ожидание: rw-rw---- или rw-r----- (не 777, не 644)
```

---

## 9. Бизнес-логика

### 9.1 Состояние гонки (Race Condition)

```bash
# Одновременное одобрение одной компенсации двумя сессиями
# Должен создаться только один CashFlowEntry и один DriverTransaction
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/compensation-requests/1/approve &
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/compensation-requests/1/approve &
wait
# Ожидание: один 200, один 409 (или оба 409 — повторное одобрение)
```

### 9.2 Отрицательные суммы

```bash
# Попытка создать расход с отрицательной суммой
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8000/api/expenses/ \
  -d '{"amount": -999999, "category": "Штрафы"}'

# Попытка отправить компенсацию с нулевой суммой
curl -X POST -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8000/api/compensation-requests/ \
  -d '{"amount": 0, "description": "test"}'
```

### 9.3 Переполнение числовых полей

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8000/api/trips/ \
  -d '{"distance_km": 999999999999, "revenue": 99999999999999}'
# Ожидание: валидация или корректное сохранение без краша
```

---

## 10. Нагрузочное тестирование (базовое)

```bash
# Установить: pip install locust  или  brew install ab

# Apache Bench — 100 запросов, 10 параллельных
ab -n 100 -c 10 -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/dashboard/weekly

# Ожидание: p95 < 500ms, ни одного 500

# Проверить кэш дашборда (TTL 90 сек)
ab -n 50 -c 5 -H "Authorization: Bearer $TOKEN" \
  http://localhost/api/dashboard/weekly
# Второй запрос должен быть быстрее первого
```

---

## 11. Специфика данных (152-ФЗ)

- Согласие (`consent_given_at`) обязательно записывается при входе
- Фото и сканы документов доступны только авторизованным (`/photos/` без токена — проверить)
- `mobile_password` водителей не возвращается через API (`_public()` в drivers.py убирает его)
- Пароли хранятся как bcrypt-хэш (проверить в БД: начинается с `$2b$`)
- При удалении пользователя — каскадное удаление или обезличивание данных?

---

## 12. Итоговый pre-prod чеклист

```
[ ] CORS_ORIGINS заменён на реальный домен (не *)
[ ] JWT_SECRET — уникальный, длина ≥ 32 байт
[ ] ADMIN_PASSWORD — изменён от дефолтного
[ ] Порт 8000 закрыт снаружи (только nginx)
[ ] server_tokens off в nginx
[ ] Заголовки безопасности добавлены в nginx
[ ] /docs и /redoc закрыты или ограничены по IP
[ ] Логин блокируется после 10 попыток (rate limit)
[ ] Path traversal в /photos/ не работает
[ ] Водитель не видит данные другого водителя
[ ] Токен сброса пароля одноразовый и с TTL
[ ] Файлы БД не доступны снаружи контейнера
[ ] Docker-контейнеры не запущены от root
[ ] Бэкап БД настроен и проверен (docker compose exec backup db-backup)
[ ] HTTPS настроен (Let's Encrypt / certbot)
```

---

## Инструменты

| Задача | Инструмент |
|---|---|
| Сканирование портов | `nmap -sV localhost` |
| Перебор директорий | `gobuster dir -u http://localhost -w wordlist.txt` |
| API-фаззинг | `ffuf -u http://localhost/api/FUZZ -w api-words.txt` |
| Анализ заголовков | `curl -I` или [securityheaders.com](https://securityheaders.com) |
| SQLi / XSS | `sqlmap -u "http://localhost/api/trips/?q=test" --cookie "..."` |
| Нагрузка | `ab`, `locust`, `k6` |
| JWT-атаки | [jwt.io](https://jwt.io) + ручной перебор алгоритмов |
| Зависимости Python | `pip audit` |
| Зависимости npm | `npm audit` |
