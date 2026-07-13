---
title: Run your own relay node
description: Deploy the Swarmbase bootstrap/relay server with Docker and point your clients at it.
---

Browsers can't accept incoming connections, so two Swarmbase peers behind NATs need a meeting point: a relay server that provides **bootstrap** (initial peer discovery over GossipSub) and **circuit relay** (forwarding traffic until — and unless — a direct WebRTC connection can be established). Every deployment needs at least one; this recipe gets a single relay running with Docker and shows how clients dial it.

## Run a single relay with Docker

The relay lives in `relay-server/` in the repository. Build and run it:

```bash
# From the repository root
docker build -t swarmbase-relay relay-server/

docker run -d \
  --name swarmbase-relay \
  -p 9001:9001 \
  -p 9002:9002 \
  -v relay-data:/shared \
  swarmbase-relay
```

Port **9001** serves WebSocket connections (browsers); port **9002** serves TCP (Node.js peers and relay-to-relay links). A single-server Compose file is also provided:

```bash
docker compose -f guides/docker/docker-compose.single.yaml up -d
```

## Get the relay's address

On startup the relay generates a peer ID and writes its connection info:

```bash
docker exec swarmbase-relay cat /shared/relay-info.json
```

```json
{
  "peerId": "12D3KooW...",
  "multiaddrs": [
    "/ip4/0.0.0.0/tcp/9001/ws/p2p/12D3KooW...",
    "/ip4/0.0.0.0/tcp/9002/p2p/12D3KooW..."
  ],
  "wsMultiaddr": "/ip4/0.0.0.0/tcp/9001/ws/p2p/12D3KooW..."
}
```

:::caution
The `wsMultiaddr` in that file contains the *listen* address (`0.0.0.0`), which is not dialable from another machine. Construct the client-facing multiaddr yourself from your server's public IP or DNS name plus the `peerId`:

```text
/dns4/relay.example.com/tcp/9001/ws/p2p/<peerId>
# or
/ip4/<PUBLIC_IP>/tcp/9001/ws/p2p/<peerId>
```
:::

## Point clients at it

In the browser, pass the relay multiaddr as a bootstrap peer:

```typescript
import { defaultConfig, defaultBootstrapConfig } from '@swarmbase/collabswarm';

const config = defaultConfig(
  defaultBootstrapConfig([
    '/dns4/relay.example.com/tcp/9001/ws/p2p/12D3KooW...',
  ]),
);
// pass `config` to collabswarm.initialize(config) / useCollabswarm(..., config)
```

In a Node.js process, use the Node-only helper from the `/node` subpath:

```typescript
import { defaultNodeConfig } from '@swarmbase/collabswarm/node';

const config = defaultNodeConfig({
  list: ['/dns4/relay.example.com/tcp/9001/ws/p2p/12D3KooW...'],
});
```

The repository's example apps read the multiaddr from a `REACT_APP_RELAY_MULTIADDR` env var — any mechanism that gets the string into your client build works.

## How it works

1. The browser dials the relay over WebSocket and completes libp2p `identify`.
2. `pubsub-peer-discovery` advertises the new peer to everyone connected to the relay, forming a GossipSub mesh.
3. The relay auto-subscribes to document topics as peers join them, so it forwards sync messages between browsers that can't reach each other yet. When all peers leave a topic it unsubscribes.
4. Where NATs allow, libp2p upgrades pairs of peers to direct WebRTC connections (using public STUN servers by default), taking the relay out of the data path.

Useful environment variables: `WS_PORT` / `TCP_PORT` (listen ports), `TOPIC_ALLOWLIST` (comma-separated topic prefixes, e.g. `/document/,/documents` — set this in production), and `MAX_AUTO_TOPICS` (cap on auto-subscriptions, default 1000).

## Going to production

For anything beyond development, two things change — TLS and redundancy. The full reference is [`docs/deployment.md`](https://github.com/swarmbase/swarmbase/blob/main/docs/deployment.md) (Docker, Caddy/TLS, Kubernetes, Fly.io, monitoring); the short version:

- **TLS is mandatory for HTTPS-served apps.** Browsers block plain `ws://` from HTTPS pages, so put a TLS-terminating reverse proxy (Caddy, nginx) in front of port 9001 and dial `/dns4/relay.example.com/tcp/443/wss/p2p/<peerId>`. Use a proxy that forwards WebSocket upgrades transparently — not one that splits the connection into a second upstream WebSocket.
- **Run two or more relays, each with its own DNS name.** Configure clients with *all* of their multiaddrs; connecting to any one is enough to discover the network.
- **Relays don't discover each other automatically.** Peers connected to different relays won't see each other's messages unless you peer the relays, e.g. by having each relay dial the others' TCP (`9002`) multiaddrs at startup.

:::caution[One load-balanced hostname across relays breaks dialing]
A libp2p multiaddr ends in a specific peer ID. If `relay.example.com` round-robins across relay-1 and relay-2, a dial to `/dns4/relay.example.com/.../p2p/<peerId-of-relay-1>` fails whenever the load balancer lands on relay-2. Give each relay its own hostname (`relay-1.example.com`, `relay-2.example.com`). In principle stable pre-generated peer IDs plus sticky sessions could make a shared hostname work, but the current relay generates a fresh peer ID on every start and exposes no option to persist one — one-hostname-per-relay is the supported path today.
:::

## Pitfalls

- **Peer IDs are ephemeral.** Every relay restart generates a new peer ID, invalidating multiaddrs baked into deployed clients. Persist and inject the libp2p key if you need stable addresses (currently requires modifying the relay code).
- **Dialing the listen address.** The most common "can't connect" cause is copying `wsMultiaddr` (a `0.0.0.0` address) straight into client config. Always construct the public address.
- **Open topic mode by default.** Without `TOPIC_ALLOWLIST`, the relay auto-subscribes to any non-system topic peers use. Fine for development; restrict it in production.
- **A relay is not a pinning service.** It forwards traffic and does not durably store document data. If all browsers holding a document go away, the relay won't save you — see [Keeping data alive](../pinning/).
- **Health checking is TCP-only.** The images ship a TCP connect check on port 9001; there is no HTTP health endpoint.
