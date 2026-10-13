# One container that runs the whole app: the API and the built web pages.
# Used by Google Cloud Run, Render, Railway, Fly.io, Koyeb or any Docker host.
# Database migrations are NOT run here — run `npm run db:migrate` from your computer.

# ---- Stage 1: install everything and build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# The Prisma schema is needed by `prisma generate`, which runs after install.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: small runtime image (production dependencies only) ----
FROM node:22-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    TRUST_PROXY=1 \
    COOKIE_SECURE=true
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --ignore-scripts --workspace backend && npm cache clean --force
# Generated Prisma client (from stage 1) + compiled code + built web pages.
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
USER node
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
