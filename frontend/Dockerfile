# ─── Stage 1: сборка ───────────────────────────────────────────────────────────
# node:20-alpine — лёгкий образ, совместим с Vite 5 + TypeScript 5.5
FROM node:20-alpine AS builder
WORKDIR /app

# Зависимости в отдельном слое — кешируются пока package.json не изменился
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Исходники и сборка
COPY . .
RUN npm run build

# ─── Stage 2: раздача статики через nginx ──────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
