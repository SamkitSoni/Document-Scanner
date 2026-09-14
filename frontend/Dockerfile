# Mirrors the backend's multi-stage shape: a dev target for compose, and a
# production target that runs the compiled Next build.
FROM node:22-alpine AS base
WORKDIR /app

# ---- dev ----
FROM base AS dev
COPY package*.json ./
RUN npm install
COPY . .
# Created ahead of the volume mounts so they are owned by the runtime user
# rather than root. Docker populates an anonymous volume from the image, and a
# root-owned .next makes every dev-server write fail with EACCES — the same
# trap the backend hit with its uploads directory.
RUN mkdir -p /app/.next && chown -R node:node /app/.next /app/node_modules
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- build ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- production ----
FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
