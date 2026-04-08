# SwarmDB - Claude Code Agent Guide

## Project Overview

SwarmDB is a distributed web (dweb) document database library providing conflict-free eventual consistency, dynamic access control with encryption, and browser-first peer-to-peer synchronization. It uses CRDTs (Yjs/Automerge), libp2p for networking, and IPFS for content-addressed storage.

**Status:** Active alpha development
**Language:** TypeScript
**Package Manager:** Yarn 4.5.0 workspaces (NEVER use npm — see below)
**Node:** 22.5.1

> **CRITICAL: Yarn Only — Do NOT use npm**
> This project uses **Yarn 4.5.0 workspaces** exclusively. **Never run `npm install`, `npm ci`, or any `npm` command** for dependency management. `package-lock.json` files are errors and must not be committed. Always use `yarn install`, `yarn add`, `yarn workspace`, etc. This applies to ALL directories including `relay-server/`, `e2e/test-app/`, and any Dockerfiles.

## Repository Structure

```
swarmbase/
├── packages/
│   ├── collabswarm/              # Core library (main entry point)
│   ├── collabswarm-automerge/    # Automerge CRDT provider
│   ├── collabswarm-yjs/          # Yjs CRDT provider
│   ├── collabswarm-react/        # React hooks/context bindings
│   └── collabswarm-redux/        # Redux integration
├── examples/
│   ├── browser-test/             # JSON editor demo (port 3001)
│   ├── wiki-swarm/               # Collaborative wiki (port 3000)
│   └── password-manager/         # Encrypted password store
├── e2e/                          # Playwright E2E tests
├── notes/                        # Design docs and architecture notes
├── SPECS.md                      # Full technical specifications
└── SWARM.md                      # Agent swarm task definitions
```

## Quick Commands

**Always use `yarn`, never `npm`.** This includes sub-projects like relay-server/ and e2e/test-app/.

```bash
# Install all workspace dependencies (NEVER use npm install)
yarn install

# Build a specific package
yarn workspace @collabswarm/collabswarm tsc
yarn workspace @collabswarm/collabswarm-yjs tsc
yarn workspace @collabswarm/collabswarm-automerge tsc
yarn workspace @collabswarm/collabswarm-react tsc
yarn workspace @collabswarm/collabswarm-redux tsc

# Run unit tests
yarn workspace @collabswarm/collabswarm test
yarn workspace @collabswarm/collabswarm-yjs test
yarn workspace @collabswarm/collabswarm-react test

# Run E2E tests (requires Docker)
docker compose build
docker compose up -d
yarn test:e2e

# Watch mode development
yarn workspace @collabswarm/collabswarm tsc-watch

# Generate API docs
yarn workspace @collabswarm/collabswarm doc
```

## Architecture Quick Reference

### Core Data Flow

1. User calls `document.change(changeFn)` → CRDT applies locally
2. Delta serialized → signed with user's private key → encrypted with document key
3. Encrypted change broadcast via GossipSub pubsub
4. Peers decrypt → verify signature against ACL → apply via CRDT provider

### Key Interfaces (Provider Pattern)

All main classes use generics: `<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>`

- **CRDTProvider**: `newDocument()`, `localChange()`, `remoteChange()`, `getHistory()`
- **AuthProvider**: `sign()`, `verify()`, `encrypt()`, `decrypt()`, key generation
- **ACLProvider**: Read/write access control list management
- **KeychainProvider**: Document encryption key management, rotation
- **ChangesSerializer / SyncMessageSerializer**: Wire format encoding

### Wire Protocols

- `/collabswarm/doc-load/1.0.0` — Initial document load (request/response to random peer)
- `/collabswarm/key-update/1.0.0` — ACL key rotation updates
- GossipSub topics: `/document/{documentId}` for pubsub change broadcast

### Transport Stack

WebRTC (browser↔browser), WebSockets (browser↔node), WebTransport, Circuit Relay V2 (NAT fallback), TCP (node↔node)

### Crypto

- **Signing:** ECDSA P-384 (identity verification)
- **Symmetric Encryption:** AES-GCM (96-bit IV, 128-bit tag)
- **Key Rotation:** New document key generated when any reader/writer is removed

## Conventions

- **Classes:** PascalCase (`CollabswarmDocument`, `SubtleCrypto`)
- **Interfaces:** PascalCase with `Provider` suffix (`CRDTProvider`, `AuthProvider`)
- **Files:** kebab-case matching class name (`collabswarm-document.ts`)
- **Private members:** Underscore prefix (`_document`, `_pubsubHandler`)
- **Tests:** Colocated with source, `.test.ts` suffix, table-driven with Jest
- **Protocol strings:** Constants in `wire-protocols.ts`

## Important: Things NOT to Do

- **Never use `npm` — always use `yarn`** (no `npm install`, `npm ci`, `npm run`, etc.)
- **Never commit `package-lock.json`** — it is gitignored; only `yarn.lock` is used
- Never log or transmit private keys
- Never skip signature verification before applying remote changes
- Never break wire protocol backward compatibility without versioning
- Never commit .env files or credentials
- Always verify ACL permissions before applying changes
- Always use secure random generation for IVs and keys

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| libp2p | 2.10.0 | P2P networking (**must be v2.x** — gossipsub incompatible with v3.x) |
| @chainsafe/libp2p-gossipsub | 14.1.2 | Pub/sub protocol (requires @libp2p/interface ^2.x) |
| @libp2p/webrtc | 5.2.24 | Browser-to-browser |
| @libp2p/circuit-relay-v2 | 3.2.24 | NAT traversal relay (uses `reservationConcurrency`, not `discoverRelays`) |
| helia | 5.5.1 | IPFS implementation (last version using libp2p v2) |
| @chainsafe/libp2p-noise | 16.1.5 | Connection encryption |
| @chainsafe/libp2p-yamux | 7.0.4 | Stream multiplexer |
| yjs | 13.6.29 | Yjs CRDT |
| @automerge/automerge | 3.2.4 | Automerge CRDT |
| @peculiar/webcrypto | 1.4.6 | WebCrypto polyfill (tests) |

## Agent Swarm Coordination

When working as part of a swarm, consult `SWARM.md` for:
- Agent role definitions and responsibilities
- Task breakdown and dependencies
- Coordination patterns between agents
- Testing requirements per work stream

When working on specifications or understanding the theory, consult `SPECS.md` for:
- Full technical specifications with academic citations
- Y.js schema design guide with conflict resolution examples
- Cryptographic architecture recommendations
- Next steps and migration plans

## Debugging

```bash
# Enable verbose libp2p logging
DEBUG=libp2p:* yarn workspace @collabswarm/browser-test start

# Enable IPFS logging
DEBUG=ipfs:* yarn workspace @collabswarm/browser-test start
```

Common issues:
- "Cannot verify signature" → Check ACL contains correct public keys
- "Failed to decrypt" → Key not in keychain, check access permissions
- Peer connection fails → NAT/firewall issue, may need relay node
- Changes not syncing → Verify GossipSub subscription and network connectivity
