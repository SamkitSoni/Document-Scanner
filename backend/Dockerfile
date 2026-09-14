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
EXPOSE 4000
CMD ["npm", "run", "start"]
