FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8010
EXPOSE 8010
CMD ["npx", "tsx", "server/index.ts"]
