FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
CMD ["npx", "tsx", "src/index.ts"]