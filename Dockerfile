FROM node:14-alpine AS builder

RUN apk update && apk add python make gcc g++

# Setup Lerna
RUN mkdir -p /app
COPY package.json /app/package.json
WORKDIR /app
RUN npm install
COPY lerna.json /app/lerna.json

# Setup package dependencies
RUN mkdir -p /app/packages/collabswarm-automerge
RUN mkdir -p /app/packages/collabswarm-redux
RUN mkdir -p /app/examples/browser-test
RUN mkdir -p /app/examples/wiki-swarm
COPY packages/collabswarm-automerge/package.json /app/packages/collabswarm-automerge/package.json
COPY packages/collabswarm-redux/package.json /app/packages/collabswarm-redux/package.json
COPY examples/browser-test/package.json /app/examples/browser-test/package.json
COPY examples/wiki-swarm/package.json /app/examples/wiki-swarm/package.json
COPY packages/collabswarm-automerge/package-lock.json /app/packages/collabswarm-automerge/package-lock.json
COPY packages/collabswarm-redux/package-lock.json /app/packages/collabswarm-redux/package-lock.json
COPY examples/browser-test/package-lock.json /app/examples/browser-test/package-lock.json
COPY examples/wiki-swarm/package-lock.json /app/examples/wiki-swarm/package-lock.json
RUN npx lerna bootstrap --force-local

FROM node:14-alpine
ENV SKIP_PREFLIGHT_CHECK=true
RUN mkdir -p /app
COPY --from=builder /app /app

# Build all packages
COPY packages/collabswarm-automerge/. /app/packages/collabswarm-automerge/
WORKDIR /app/packages/collabswarm-automerge
RUN npm run tsc
RUN npm link

COPY packages/collabswarm-redux/. /app/packages/collabswarm-redux/
WORKDIR /app/packages/collabswarm-redux
RUN npm run tsc

COPY examples/browser-test/. /app/examples/browser-test/
COPY examples/wiki-swarm/. /app/examples/wiki-swarm/

COPY wait-for-file.sh /app/wait-for-file.sh
RUN chmod +x /app/wait-for-file.sh

WORKDIR /app
CMD collabswarm-automerge-d
