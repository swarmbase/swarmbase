FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json ./
RUN yarn install
COPY . .
RUN yarn build

FROM node:22-alpine
RUN corepack enable
WORKDIR /app
RUN yarn global add serve
COPY --from=build /app/dist ./dist
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
