# ---- base ----
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ---- dev ----
FROM base AS dev
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
# Created ahead of the volume mount so it is owned by the runtime user rather
# than root; a root-owned upload directory would make writes fail.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- build ----
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# ---- production ----
FROM base AS production
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# The Prisma CLI is a devDependency, so `npm ci --omit=dev` above leaves it out.
# It is copied in deliberately: `migrate deploy` runs at container start (see
# `start:migrate`), because Render's free plan has no pre-deploy hook and a
# Dockerfile build makes the dashboard's Build Command a no-op.
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY scripts ./scripts
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 4000
CMD ["npm", "run", "start:migrate"]
