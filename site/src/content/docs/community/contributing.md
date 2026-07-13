---
title: Contributing to Swarmbase
description: How to set up a Swarmbase development environment, find your way around the monorepo, run the test suites, and get a pull request merged.
---

Swarmbase is in alpha, and this is the best possible time to get involved: the core API is still being shaped, and contributions of every size — from a typo fix to a new test suite — have an outsized impact. This page gets you from `git clone` to a merged pull request.

If you haven't picked something to work on yet, start with [what we need help with](../help-wanted/).

## Development setup

### Prerequisites

- **Node.js >= 22.19.0** — the repository pins its Node version in `.tool-versions` (works with [asdf](https://asdf-vm.com/) and [mise](https://mise.jdx.dev/)).
- **Yarn 4** — the repo commits its own Yarn release (`.yarn/releases`), so after `corepack enable` the right version is used automatically. Do **not** use npm; the workspace setup depends on Yarn 4 and npm installs will fail.
- **Docker with Docker Compose** — needed for the example stack and for the end-to-end, integration, and NAT test suites. Unit tests run without it.

### Build and test

```sh
git clone https://github.com/swarmbase/swarmbase.git
cd swarmbase
corepack enable   # activates the pinned Yarn 4 release
yarn install      # installs and links all workspaces
yarn build        # typechecks and builds the six library packages
yarn test         # runs the Jest unit tests for all six packages
```

If all of that passes, you have a working development environment.

### Run the examples

A `docker-compose.yaml` at the repo root starts a relay server plus two example apps with live rebuild-on-save:

```sh
docker compose build
docker compose up
```

- **wiki-swarm** on <http://localhost:3000>
- **browser-test** on <http://localhost:3001>

Open the same example in two browser windows to watch documents sync peer-to-peer.

## Monorepo map

Everything lives in one Yarn 4 workspace. The packages you will touch most:

| Path | What it is |
| --- | --- |
| `packages/collabswarm` | The core library: `Collabswarm`, `CollabswarmDocument`, and `CollabswarmNode` — libp2p networking, Merkle-DAG change storage over Helia/IPFS, encryption and signing (`auth-provider.ts`), ACLs and group key management (`acl*.ts`, `beekem/`), compaction, and the CRDT-agnostic provider interfaces. |
| `packages/collabswarm-yjs` | CRDT provider that plugs [Yjs](https://yjs.dev/) documents into the core (`collabswarm-yjs.ts`). |
| `packages/collabswarm-automerge` | CRDT provider for [Automerge](https://automerge.org/), plus `bin/collabswarm-automerge-d.ts`, a headless Node.js swarm node daemon. |
| `packages/collabswarm-react` | React bindings: `CollabswarmContext`, `useCollabswarm`, and `useCollabswarmDocumentState` hooks (`hooks.ts`). |
| `packages/collabswarm-redux` | Redux bindings: async actions like `connectAsync`/`openDocumentAsync`/`changeDocumentAsync` and matching reducers. |
| `packages/collabswarm-index` | Distributed indexing and query engine: encrypted blind indexes, Bloom-filter gossip, pluggable index storage (in-memory and IndexedDB), and React bindings. |
| `examples/browser-test` | Minimal React app exposing a raw JSON editor over a shared document (Automerge + Redux bindings) — the workhorse for manual sync testing. |
| `examples/wiki-swarm` | A collaborative wiki with a Slate rich-text editor (Automerge + Redux bindings). |
| `examples/password-manager` | A shared password manager with login, password list/editor, and a permissions table (Yjs + React hooks) — exercises the access-control APIs. |
| `relay-server/` | Standalone libp2p relay: Circuit Relay V2 + GossipSub over WebSockets/TCP, used for NAT traversal when browsers can't connect directly. Ships a Dockerfile and a Fly.io config (`fly.toml`). |
| `e2e/` | Playwright suites: `multi-user.spec.ts` against the browser-test example, `integration/` specs (peer discovery, bidirectional sync, resilience, NAT traversal), and `test-app/`, a minimal libp2p browser app the integration stacks serve. |

Supporting directories: `notes/` (design notes, including `notes/testing.md`), `guides/` (deployment and schema guides), and `scripts/` (e.g. `run-integration-test.sh`).

> **Note on package names:** the npm scope is moving to `@swarmbase/*` (e.g. `@swarmbase/collabswarm`). If a `yarn workspace @swarmbase/...` command reports an unknown workspace on your checkout, the rename may not have landed there yet — substitute the old `@collabswarm/*` scope.

## Test matrix

Different changes call for different suites. From cheapest to heaviest:

| Command | What it runs | When to run it |
| --- | --- | --- |
| `yarn test` | Jest unit tests across all six library packages. | Always. Every change. |
| `yarn workspace @swarmbase/collabswarm test` | Unit tests for a single package (any workspace name works). | Fast iteration while you work on one package. |
| `yarn test:e2e` | Playwright multi-user tests against the browser-test example. Outside CI it starts `docker compose up browser-test` for you (port 3001). | Changes to networking, document sync, or the browser-test example. |
| `yarn test:integration` | Playwright specs in `e2e/integration/` — peer discovery, bidirectional sync, resilience — against a Docker stack of one relay and two test-app instances. | Changes to the relay server, libp2p configuration, or sync protocol. |
| `yarn test:nat` | The NAT traversal and resilience specs, with clients on isolated Docker networks that can only reach each other through the relay. | Changes to relay, transports, or anything NAT/firewall related. |
| `yarn benchmark:all` | Benchmarks in the core and index packages: crypto overhead, CRDT sync latency, convergence simulation, blind-index and Bloom-filter scaling. | Performance-sensitive changes; include before/after numbers in your PR. |

The integration and NAT suites need their Docker stacks running first:

```sh
# Integration tests
docker compose -f docker-compose.integration.yaml build
docker compose -f docker-compose.integration.yaml up -d
yarn test:integration
docker compose -f docker-compose.integration.yaml down -v

# NAT traversal tests
docker compose -f docker-compose.nat-test.yaml build
docker compose -f docker-compose.nat-test.yaml up -d
yarn test:nat
docker compose -f docker-compose.nat-test.yaml down -v
```

`scripts/run-integration-test.sh` wraps the integration flow, including waiting for the relay to become healthy. Playwright itself needs a browser once: `yarn exec playwright install chromium`.

For more detail on the testing approach, see `notes/testing.md` and `e2e/README.md` in the repo.

## Pull request expectations

1. **Discuss first for anything non-trivial.** Open a [GitHub issue](https://github.com/swarmbase/swarmbase/issues) or start a [discussion](https://github.com/swarmbase/swarmbase/discussions) before writing a large change. Swarmbase is alpha and the core API is still moving — a short conversation up front saves everyone rework. Typos, small bug fixes, and test additions can go straight to a PR.
2. **Keep PRs small and focused.** One logical change per PR. A 100-line PR gets reviewed in a day; a 2,000-line PR sits.
3. **CI must pass.** Every PR runs the full matrix on GitHub Actions (`.github/workflows/ci.yml`): typecheck (`yarn build`), unit tests per package, the integration suite, and the NAT traversal suite. Run the relevant suites locally before pushing.
4. **Add tests with behavior changes.** Bug fixes should come with a regression test; new features with unit tests, and e2e/integration coverage where networking is involved.
5. **Match the house style.** The repo uses Prettier (`.prettierrc`); most editors pick it up automatically.

Reviews are handled by the maintainer listed in `CODEOWNERS`. Swarmbase is MIT-licensed, and your contributions are accepted under the same license.

Stuck at any point? Open an issue — a confusing setup step is itself a bug worth reporting.
