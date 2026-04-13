# SwarmDB Coordination Server Deployment Guide

SwarmDB browser peers connect through coordination servers that provide two
functions: **circuit relay** (proxying connections between browsers that cannot
reach each other directly) and **bootstrap** (helping new peers discover the
network via pubsub peer discovery).

The relay server in `relay-server/` fulfills both roles. Every deployment needs
at least one relay server. Browser peers connect to it over WebSocket; Node.js
peers can also connect over TCP.

## Quick Start -- Single Server

The fastest way to get a relay running:

```bash
# Build the relay image
docker build -t swarmdb-relay relay-server/

# Run it
docker run -d \
  --name swarmdb-relay \
  -p 9001:9001 \
  -p 9002:9002 \
  -v relay-data:/shared \
  swarmdb-relay
```

Port 9001 serves WebSocket connections (browsers). Port 9002 serves TCP
connections (Node.js peers and inter-relay communication).

After startup the relay writes `/shared/relay-info.json` containing its peer ID
and multiaddresses. Retrieve it with:

```bash
docker exec swarmdb-relay cat /shared/relay-info.json
```

Example output:

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

Pass the `wsMultiaddr` value to your SwarmDB client configuration so browsers
know where to connect.

Or use the provided single-server Compose file:

```bash
docker compose -f guides/docker/docker-compose.single.yaml up -d

# Retrieve relay info
docker compose -f guides/docker/docker-compose.single.yaml \
  exec relay cat /shared/relay-info.json
```

## Environment Variables

All configuration is done through environment variables on the relay process.

| Variable | Default | Description |
|---|---|---|
| `WS_PORT` | `9001` | WebSocket listen port |
| `TCP_PORT` | `9002` | TCP listen port |
| `WS_LISTEN` | `/ip4/0.0.0.0/tcp/$WS_PORT/ws` | Full WebSocket multiaddr |
| `TCP_LISTEN` | `/ip4/0.0.0.0/tcp/$TCP_PORT` | Full TCP multiaddr |
| `ENABLE_IPV6` | (unset) | Set to `1` to add IPv6 listeners |
| `WS_LISTEN_V6` | `/ip6/::/tcp/$WS_PORT/ws` | IPv6 WebSocket multiaddr |
| `TCP_LISTEN_V6` | `/ip6/::/tcp/$TCP_PORT` | IPv6 TCP multiaddr |
| `DOCUMENT_PUBLISH_PATH` | `/documents` | Topic for document publish notifications |
| `EXTRA_TOPICS` | (unset) | Comma-separated additional topics to subscribe to |
| `TOPIC_ALLOWLIST` | (unset) | Comma-separated topic prefixes. Only matching topics are auto-subscribed. Unset means open mode (all non-system topics allowed). Example: `/document/,/documents` |
| `MAX_AUTO_TOPICS` | `1000` | Maximum number of auto-subscribed topics. Prevents unbounded memory growth from topic spam. |

### IPv6 Notes

On most Linux hosts `::` is dual-stack, so binding both IPv4 and IPv6 on the
same port causes `EADDRINUSE`. Only set `ENABLE_IPV6=1` on platforms where the
IPv6 socket is **not** dual-stack, or when using separate ports.

### Topic Auto-Subscribe

The relay automatically subscribes to document topics as peers join them. This
means the relay can forward messages between browser peers that have not yet
established a direct WebRTC connection. When all peers leave a topic the relay
automatically unsubscribes.

For production, set `TOPIC_ALLOWLIST` to restrict which topic prefixes are
accepted, and keep `MAX_AUTO_TOPICS` at a reasonable limit for your deployment.

## Production Multi-Server Deployment

For reliability, run two or more relay servers behind a reverse proxy with TLS.
The `guides/docker/` directory contains a ready-made Compose file and Caddy
configuration.

### Prerequisites

1. A domain name with DNS A records pointing to your server (e.g.
   `relay.example.com`).
2. Ports 80 and 443 open for Caddy's automatic Let's Encrypt certificates.
3. Port 9002 open between relay servers for TCP mesh communication.

### Deploy

```bash
export RELAY_DOMAIN=relay.example.com

docker compose -f guides/docker/docker-compose.production.yaml up -d
```

This starts:

- **Caddy** -- Reverse proxy on ports 80/443. Terminates TLS and load-balances
  WebSocket connections across relay nodes with round-robin.
- **relay-1** -- Primary relay / bootstrap node.
- **relay-2** -- Secondary relay node.

Browser clients connect to `wss://relay.example.com` instead of a raw
WebSocket port.

### Scaling Beyond Two Relays

Add more relay services to `docker-compose.production.yaml` and include them in
the Caddyfile's `reverse_proxy` upstream list:

```
# Caddyfile
{$RELAY_DOMAIN} {
    reverse_proxy relay-1:9001 relay-2:9001 relay-3:9001 {
        lb_policy round_robin
        header_up Connection {>Connection}
        header_up Upgrade {>Upgrade}
    }
}
```

In a true production deployment, run each relay on a separate server and point
Caddy (or your own load balancer) at their IP addresses.

### Hardening Checklist

- Set `TOPIC_ALLOWLIST` to restrict auto-subscribed topics.
- Set `MAX_AUTO_TOPICS` to cap memory usage from topic subscriptions.
- Run the relay as a non-root user (the Dockerfiles already do this).
- Use `restart: unless-stopped` in Compose (already set in the production file).
- Monitor the health check endpoint -- the relay verifies port 9001 is
  accepting TCP connections.

## Docker Images

The repository provides three Dockerfiles:

| File | Purpose | Build command |
|---|---|---|
| `relay-server/Dockerfile` | Standard relay (used by `docker-compose.yaml`) | `docker build -t swarmdb-relay relay-server/` |
| `guides/docker/Dockerfile.relay` | Standalone relay with extended comments | `docker build -f guides/docker/Dockerfile.relay -t swarmdb-relay relay-server/` |
| `guides/docker/Dockerfile.bootstrap` | Dedicated DHT bootstrap node (500+ peers) | `docker build -f guides/docker/Dockerfile.bootstrap -t swarmdb-bootstrap relay-server/` |

All images are based on `node:22-alpine`, run as a non-root `app` user, and
include a built-in health check.

### Bootstrap Node vs Relay Server

For most deployments, the standard relay server is sufficient. It provides both
circuit relay and pubsub-based peer discovery.

A dedicated bootstrap node (`Dockerfile.bootstrap`) is only needed for large
deployments (500+ peers) where pubsub-based discovery alone is insufficient and
Kademlia DHT bootstrap is required.

## Kubernetes Deployment

SwarmDB relay servers are stateless and straightforward to run on Kubernetes.

### Key Considerations

- **WebSocket affinity**: The relay uses long-lived WebSocket connections. Use
  session affinity (`service.spec.sessionAffinity: ClientIP`) or a WebSocket-
  aware ingress controller (NGINX Ingress, Traefik, etc.).
- **Health checks**: Use the built-in TCP check on port 9001 for both liveness
  and readiness probes.
- **Scaling**: Each relay is independent. Scale the Deployment replica count as
  needed. Peers discover each other through pubsub, so relays do not need to
  know about each other ahead of time.

### Example Manifests

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: swarmdb-relay
spec:
  replicas: 2
  selector:
    matchLabels:
      app: swarmdb-relay
  template:
    metadata:
      labels:
        app: swarmdb-relay
    spec:
      containers:
        - name: relay
          image: swarmdb-relay:latest
          ports:
            - containerPort: 9001
              name: ws
            - containerPort: 9002
              name: tcp
          env:
            - name: TOPIC_ALLOWLIST
              value: "/document/,/documents"
            - name: MAX_AUTO_TOPICS
              value: "5000"
          livenessProbe:
            tcpSocket:
              port: 9001
            initialDelaySeconds: 10
            periodSeconds: 10
          readinessProbe:
            tcpSocket:
              port: 9001
            initialDelaySeconds: 5
            periodSeconds: 5
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: swarmdb-relay
spec:
  type: ClusterIP
  sessionAffinity: ClientIP
  selector:
    app: swarmdb-relay
  ports:
    - name: ws
      port: 9001
      targetPort: 9001
    - name: tcp
      port: 9002
      targetPort: 9002
```

Pair with an Ingress resource that supports WebSocket upgrade for external
browser access:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: swarmdb-relay
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  tls:
    - hosts:
        - relay.example.com
      secretName: relay-tls
  rules:
    - host: relay.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: swarmdb-relay
                port:
                  number: 9001
```

## Monitoring

The relay server logs the following events to stdout:

- Peer connections and disconnections
- Topic auto-subscribe and auto-unsubscribe events
- Auto-subscribe cap warnings (when `MAX_AUTO_TOPICS` is reached)

Use standard container log aggregation (e.g., `docker logs`, Loki, CloudWatch)
to monitor relay health.

## Troubleshooting

**Peers cannot discover each other**
- Verify the relay is running and healthy: `docker exec swarmdb-relay cat /shared/relay-info.json`
- Ensure browser clients are configured with the correct `wsMultiaddr`.
- Check that port 9001 is accessible from the browser's network.

**Messages not relaying between peers**
- The relay must be subscribed to the same topics as the peers. Verify
  auto-subscribe is working by checking relay logs for `Auto-subscribed to topic`.
- If `TOPIC_ALLOWLIST` is set, confirm the document topics match one of the
  allowed prefixes.

**EADDRINUSE on startup**
- Another process is using port 9001 or 9002. Change ports via `WS_PORT` /
  `TCP_PORT` environment variables.
- If using `ENABLE_IPV6=1`, your platform's `::` may be dual-stack. Remove the
  IPv6 flag or use separate ports.
