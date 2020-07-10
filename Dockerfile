FROM node:14-alpine AS builder

RUN apk update && apk add python make gcc g++

# Setup Lerna
RUN mkdir -p /app
COPY package.json /app/package.json
WORKDIR /app
RUN npm install
COPY lerna.json /app/lerna.json

# Setup package dependencies
RUN mkdir -p /app/packages/automerge-swarm
RUN mkdir -p /app/packages/automerge-swarm-redux
RUN mkdir -p /app/examples/browser-test
RUN mkdir -p /app/examples/wiki-swarm
COPY packages/automerge-swarm/package.json /app/packages/automerge-swarm/package.json
COPY packages/automerge-swarm-redux/package.json /app/packages/automerge-swarm-redux/package.json
COPY examples/browser-test/package.json /app/examples/browser-test/package.json
COPY examples/wiki-swarm/package.json /app/examples/wiki-swarm/package.json
COPY packages/automerge-swarm/package-lock.json /app/packages/automerge-swarm/package-lock.json
COPY packages/automerge-swarm-redux/package-lock.json /app/packages/automerge-swarm-redux/package-lock.json
COPY examples/browser-test/package-lock.json /app/examples/browser-test/package-lock.json
COPY examples/wiki-swarm/package-lock.json /app/examples/wiki-swarm/package-lock.json
RUN npx lerna bootstrap --force-local

FROM node:14-alpine
ENV SKIP_PREFLIGHT_CHECK=true
RUN mkdir -p /app
COPY --from=builder /app /app

# Build all packages
COPY packages/automerge-swarm/. /app/packages/automerge-swarm/
WORKDIR /app/packages/automerge-swarm
RUN npm run tsc
RUN npm link

COPY packages/automerge-swarm-redux/. /app/packages/automerge-swarm-redux/
WORKDIR /app/packages/automerge-swarm-redux
RUN npm run tsc

COPY examples/browser-test/. /app/examples/browser-test/
COPY examples/wiki-swarm/. /app/examples/wiki-swarm/

WORKDIR /app
CMD automerge-swarm-d
