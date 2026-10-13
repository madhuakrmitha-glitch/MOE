FROM node:22-alpine AS web
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MOE_FRONTEND_DIR=/app/frontend/dist MOE_DATA_DIR=/app/data
WORKDIR /app/backend
COPY backend/ ./
RUN pip install --no-cache-dir . -c requirements.lock && useradd --uid 10001 --create-home moe && mkdir -p /app/data && chown -R moe:moe /app
COPY --from=web /build/dist /app/frontend/dist
USER moe
EXPOSE 8000
CMD ["uvicorn", "moe.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
