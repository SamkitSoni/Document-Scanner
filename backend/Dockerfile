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
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node
EXPOSE 4000
CMD ["npm", "run", "start"]
