FROM node:14-alpine AS builder

RUN apk update && apk add python make gcc g++

# Setup Lerna
RUN mkdir -p /app
WORKDIR /app
# RUN npm install -g yarn

# Setup package dependencies
COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock
RUN mkdir -p /app/packages/collabswarm-automerge
RUN mkdir -p /app/packages/collabswarm-redux
RUN mkdir -p /app/examples/browser-test
RUN mkdir -p /app/examples/wiki-swarm
COPY packages/collabswarm-automerge/package.json /app/packages/collabswarm-automerge/package.json
COPY packages/collabswarm-redux/package.json /app/packages/collabswarm-redux/package.json
COPY examples/browser-test/package.json /app/examples/browser-test/package.json
COPY examples/wiki-swarm/package.json /app/examples/wiki-swarm/package.json
RUN yarn install

FROM node:14-alpine
ENV SKIP_PREFLIGHT_CHECK=true
RUN mkdir -p /app
COPY --from=builder /app /app
WORKDIR /app

# Build all packages
COPY packages/collabswarm-automerge/. /app/packages/collabswarm-automerge/
# WORKDIR /app/packages/collabswarm-automerge
RUN yarn workspace @collabswarm/collabswarm-automerge run tsc
RUN yarn workspace @collabswarm/collabswarm-automerge link

COPY packages/collabswarm-redux/. /app/packages/collabswarm-redux/
# WORKDIR /app/packages/collabswarm-redux
RUN yarn workspace @collabswarm/collabswarm-redux run tsc
# RUN npm run tsc

COPY examples/browser-test/. /app/examples/browser-test/
COPY examples/wiki-swarm/. /app/examples/wiki-swarm/

COPY wait-for-file.sh /app/wait-for-file.sh
RUN chmod +x /app/wait-for-file.sh

WORKDIR /app
CMD collabswarm-automerge-d
