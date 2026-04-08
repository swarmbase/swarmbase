# SwarmDB Agent Swarm Configuration

## Overview

This document defines how multiple Claude Code agents coordinate to work on SwarmDB. Each agent has a defined role, scope, and set of responsibilities. Agents work in parallel on independent tasks and coordinate through shared artifacts (code, tests, documentation).

> **MANDATORY: Use `yarn` exclusively. Never use `npm`.** This project uses Yarn 4.5.0 workspaces. All agents MUST use `yarn install`, `yarn add`, `yarn workspace`, etc. Never run `npm install`, `npm ci`, or `npm run`. Never create `package-lock.json` files. This applies to all directories including relay-server/, e2e/test-app/, and Dockerfiles.

---

## Agent Roles

### Agent 1: Core Library (packages/collabswarm)

**Scope:** `packages/collabswarm/src/`

**Responsibilities:**
- Core `Collabswarm` and `CollabswarmDocument` classes
- Provider interfaces (CRDTProvider, AuthProvider, ACLProvider, KeychainProvider)
- Serialization layer (ChangesSerializer, SyncMessageSerializer, JSONSerializer)
- Wire protocols and Merkle-DAG structure
- `SubtleCrypto` authentication implementation
- Utility functions

**Key files:**
- `collabswarm.ts` - Main entry, IPFS node management
- `collabswarm-document.ts` - Document sync, change handling
- `collabswarm-node.ts` - Node configuration, libp2p setup
- `collabswarm-config.ts` - Configuration types
- `auth-subtlecrypto.ts` - WebCrypto implementation
- `crdt-change-node.ts`, `crdt-sync-message.ts` - Data structures

**Test files:** `*.test.ts` in same directory

**Build:** `yarn workspace @collabswarm/collabswarm tsc`
**Test:** `yarn workspace @collabswarm/collabswarm test`

---

### Agent 2: CRDT Providers (packages/collabswarm-yjs, packages/collabswarm-automerge)

**Scope:** `packages/collabswarm-yjs/src/`, `packages/collabswarm-automerge/src/`

**Responsibilities:**
- Yjs CRDT provider implementation
- Automerge CRDT provider implementation
- CRDT-specific ACL and Keychain implementations
- CRDT-specific serialization
- Schema design patterns and examples

**Key files (Yjs):**
- `yjs-provider.ts` - Y.Doc operations
- `yjs-acl.ts` - ACL as Yjs document
- `yjs-keychain.ts` - Key management
- `yjs-json-serializer.ts` - Serialization

**Key files (Automerge):**
- `automerge-provider.ts` - Automerge.Doc operations
- `automerge-acl.ts` - ACL as Automerge document
- `automerge-json-serializer.ts` - Serialization

**Build:** `yarn workspace @collabswarm/collabswarm-yjs tsc`
**Test:** `yarn workspace @collabswarm/collabswarm-yjs test`

---

### Agent 3: Frontend Integration (packages/collabswarm-react, packages/collabswarm-redux)

**Scope:** `packages/collabswarm-react/src/`, `packages/collabswarm-redux/src/`

**Responsibilities:**
- React context and hooks
- Redux middleware and reducers
- Frontend API surface
- Example app maintenance (browser-test, wiki-swarm, password-manager)

**Build:** `yarn workspace @collabswarm/collabswarm-react tsc`
**Test:** `yarn workspace @collabswarm/collabswarm-react test`

---

### Agent 4: Networking & Infrastructure

**Scope:** `docker-compose.yaml`, `Dockerfile`, `packages/collabswarm/src/collabswarm-node.ts`, `packages/collabswarm/src/collabswarm-config.ts`

**Responsibilities:**
- libp2p configuration and transport setup
- Docker infrastructure (relay nodes, signaling, bootstrap)
- NAT traversal and connectivity
- Coordination server setup and documentation
- Helia/IPFS migration

**Key concerns:**
- Transport stack configuration (WebRTC, WebSockets, Circuit Relay)
- Peer discovery (bootstrap nodes, Kad-DHT)
- GossipSub configuration
- Docker network topology for testing

---

### Agent 5: Security & Cryptography

**Scope:** `packages/collabswarm/src/auth-*.ts`, `packages/collabswarm/src/acl*.ts`, `packages/collabswarm/src/keychain*.ts`

**Responsibilities:**
- Authentication and authorization implementation
- Key exchange protocols
- Forward secrecy implementation
- ACL chain-of-trust verification
- Add/remove user flows
- Evaluating and integrating crypto libraries (MLS, ZKPs, proxy re-encryption)

**Reference:** SPECS.md Section 9 (Homomorphic Encryption Assessment) for recommended architecture.

---

### Agent 6: Testing & Quality

**Scope:** `e2e/`, `**/*.test.ts`, `.github/workflows/`

**Responsibilities:**
- Unit test coverage expansion
- E2E test scenarios (including NAT traversal)
- CI/CD pipeline maintenance
- Integration test design for multi-peer scenarios
- Performance benchmarking

**Test commands:**
```bash
# All unit tests
yarn workspace @collabswarm/collabswarm test
yarn workspace @collabswarm/collabswarm-yjs test
yarn workspace @collabswarm/collabswarm-react test

# E2E tests
docker compose build && docker compose up -d
yarn test:e2e
```

---

## Task Dependencies

```
Core Library (Agent 1) ← CRDT Providers (Agent 2)
                       ← Frontend Integration (Agent 3)
                       ← Security (Agent 5)

Networking (Agent 4)   ← Testing/E2E (Agent 6)

Security (Agent 5)     ← Testing (Agent 6) [security tests]
```

Changes to provider interfaces in Agent 1 require corresponding updates in Agents 2, 3, and 5.

---

## Major Work Streams

### WS-1: Helia Migration (Agent 1 + Agent 4)

**Goal:** Replace js-ipfs patterns with Helia API.

**Tasks:**
1. [ ] Audit all IPFS imports across packages
2. [ ] Update `Collabswarm.ts` to use `createHelia()` API
3. [ ] Update `CollabswarmDocument.ts` block storage calls
4. [ ] Update `collabswarm-node.ts` libp2p configuration
5. [ ] Update Docker images and configurations
6. [ ] Update example apps
7. [ ] Verify content-addressing works with Helia CID handling
8. [ ] Remove deprecated js-ipfs dependencies

**Agent 1** handles core library changes. **Agent 4** handles Docker/infrastructure. Both coordinate on `collabswarm-node.ts`.

---

### WS-2: Integration Testing Across NAT (Agent 4 + Agent 6)

**Goal:** Verify browser-to-browser sync across simulated NAT boundaries.

**Tasks:**
1. [ ] Design Docker network topology with isolated networks
2. [ ] Create relay/bootstrap node Docker configuration
3. [ ] Write Playwright tests for cross-NAT document sync
4. [ ] Test document creation, opening, editing, convergence
5. [ ] Test failure scenarios (relay down, browser offline, rapid edits)
6. [ ] Add CI pipeline for NAT traversal tests
7. [ ] Document test infrastructure setup

**Agent 4** designs infrastructure. **Agent 6** writes tests.

---

### WS-3: Coordination Server Documentation (Agent 4)

**Goal:** Clear documentation of what servers are needed and how to deploy them.

**Tasks:**
1. [ ] Document each server type (bootstrap, relay, signaling, STUN, TURN, pinning)
2. [ ] Create Docker deployment configs for each
3. [ ] Write minimal single-server setup guide
4. [ ] Write production multi-server deployment guide
5. [ ] Document public alternatives and cost considerations

---

### WS-4: Authentication & Encryption (Agent 5)

**Goal:** Full authentication and access control without side-channel key distribution.

**Tasks:**
1. [ ] Evaluate MLS (`@river-build/mls-rs-wasm`) for group key management
2. [ ] Implement secure key exchange (Signal X3DH or MLS)
3. [ ] Implement forward secrecy (key ratcheting)
4. [ ] Implement ACL chain-of-trust verification on document load
5. [ ] Implement initial load quorum verification
6. [ ] Implement add-user flow (key distribution via MLS)
7. [ ] Implement remove-user flow (key rotation + re-distribution)
8. [ ] Handle concurrent add/remove conflicts
9. [ ] Evaluate ZKP authentication (snarkjs) for privacy-preserving membership proofs
10. [ ] Security audit of new crypto code

---

### WS-5: Indexing Support (Agent 1 + Agent 2)

**Goal:** Cross-document querying and search.

**Tasks:**
1. [ ] Design index architecture (local vs. distributed)
2. [ ] Implement local IndexedDB-based index
3. [ ] Implement field-level indexing API
4. [ ] Implement query API (`swarm.query()`)
5. [ ] Design distributed index as CRDT document
6. [ ] Implement distributed index sync
7. [ ] Evaluate full-text search integration

---

### WS-6: Y.js Schema Design Documentation (Agent 2)

**Goal:** Comprehensive guide for designing schemas that work well with Y.js CRDTs.

**Tasks:**
1. [ ] Document all shared types and their conflict resolution behavior
2. [ ] Create examples for each pattern (LWW, add-wins set, ordered list, etc.)
3. [ ] Document anti-patterns with explanations
4. [ ] Create schema design checklist
5. [ ] Add examples for common application types (todo app, wiki, chat, form)
6. [ ] Document performance implications of schema choices

Reference: SPECS.md Section 7 contains the initial guide.

---

## Coordination Patterns

### Before Starting Work

1. Read `CLAUDE.md` for project context and conventions
2. Read `SPECS.md` for technical specifications and citations
3. Read this file (`SWARM.md`) for your agent role and current tasks
4. Check the relevant source files before making changes
5. Run existing tests to establish baseline: `yarn workspace <package> test`

### When Making Changes

1. Follow existing conventions (naming, file structure, TypeScript patterns)
2. Preserve generic type parameters throughout the provider chain
3. Add tests for new functionality
4. Update TypeDoc comments for public APIs
5. Consider security implications (especially for auth/ACL/crypto changes)
6. Maintain backward compatibility with wire protocols (version new protocols)
7. Run `tsc` to verify compilation after changes

### When Work Streams Overlap

If your change affects another agent's scope:
1. Make the minimal necessary change in the overlapping file
2. Document what changed and why
3. Ensure tests pass for both packages
4. Coordinate through clearly named git branches

### Quality Gates

Before considering a work stream complete:
- [ ] All existing tests still pass
- [ ] New functionality has test coverage
- [ ] TypeScript compiles without errors
- [ ] No security regressions (signature verification, encryption, ACL enforcement)
- [ ] Documentation updated if public API changed
- [ ] E2E tests pass (if networking or sync changes)

---

*Last updated: 2026-02-24*
