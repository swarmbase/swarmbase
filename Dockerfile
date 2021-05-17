FROM node:14-alpine AS builder

RUN apk update && apk add python make gcc g++ gettext

RUN mkdir -p /app
WORKDIR /app

# Setup package dependencies
COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock
RUN mkdir -p /app/packages/collabswarm
RUN mkdir -p /app/packages/collabswarm-automerge
RUN mkdir -p /app/packages/collabswarm-yjs
RUN mkdir -p /app/packages/collabswarm-react
RUN mkdir -p /app/packages/collabswarm-redux
RUN mkdir -p /app/examples/browser-test
RUN mkdir -p /app/examples/wiki-swarm
COPY packages/collabswarm/package.json /app/packages/collabswarm/package.json
COPY packages/collabswarm-automerge/package.json /app/packages/collabswarm-automerge/package.json
COPY packages/collabswarm-yjs/package.json /app/packages/collabswarm-yjs/package.json
COPY packages/collabswarm-react/package.json /app/packages/collabswarm-react/package.json
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
COPY packages/collabswarm/. /app/packages/collabswarm/
RUN yarn workspace @collabswarm/collabswarm run tsc

COPY packages/collabswarm-automerge/. /app/packages/collabswarm-automerge/
RUN yarn workspace @collabswarm/collabswarm-automerge run tsc
RUN yarn workspace @collabswarm/collabswarm-automerge link
RUN chmod +x /usr/local/bin/collabswarm-automerge-d

COPY packages/collabswarm-yjs/. /app/packages/collabswarm-yjs/
RUN yarn workspace @collabswarm/collabswarm-yjs run tsc
RUN yarn workspace @collabswarm/collabswarm-yjs link
RUN chmod +x /usr/local/bin/collabswarm-yjs-d

COPY packages/collabswarm-react/. /app/packages/collabswarm-react/
RUN yarn workspace @collabswarm/collabswarm-react run tsc

COPY packages/collabswarm-redux/. /app/packages/collabswarm-redux/
RUN yarn workspace @collabswarm/collabswarm-redux run tsc

COPY examples/browser-test/. /app/examples/browser-test/
COPY examples/wiki-swarm/. /app/examples/wiki-swarm/

COPY wait-for-file.sh /app/wait-for-file.sh
RUN chmod +x /app/wait-for-file.sh

WORKDIR /app
CMD collabswarm-automerge-d
