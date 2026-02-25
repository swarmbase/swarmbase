FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install
COPY src ./src
RUN yarn exec tsc
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
HEALTHCHECK --interval=3s --timeout=3s --retries=20 --start-period=5s \
  CMD node -e "const net = require('net'); const s = net.createConnection(9001, '127.0.0.1', () => { s.end(); process.exit(0); }); s.on('error', () => process.exit(1));"
CMD ["node", "dist/index.js"]
