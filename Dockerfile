FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY services/ ./services/
COPY apps/ ./apps/

RUN npm ci

COPY . .

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "${NPM_COMMAND}"]
