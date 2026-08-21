# Swarmbase

[![CI](https://github.com/swarmbase/swarmbase/actions/workflows/ci.yml/badge.svg)](https://github.com/swarmbase/swarmbase/actions/workflows/ci.yml)
[![Site](https://github.com/swarmbase/swarmbase/actions/workflows/site.yml/badge.svg)](https://github.com/swarmbase/swarmbase/actions/workflows/site.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://swarmbase.github.io/swarmbase/community/contributing/)
[![Docs](https://img.shields.io/badge/docs-swarmbase.github.io-4f46e5)](https://swarmbase.github.io/swarmbase/)

Open-source TypeScript toolkit for encrypted, local-first CRDT documents that sync peer to peer. Build collaborative browser applications without a server seeing your data in plaintext.


**Documentation:** https://swarmbase.github.io/swarmbase/

## Quick start from source

Requires Node.js 22.19.0 and Yarn 4.5.0 through Corepack.

```sh
git clone https://github.com/swarmbase/swarmbase.git
cd swarmbase
corepack enable
yarn install --immutable
yarn build
yarn exec playwright install chromium
yarn test:e2e:browser-test
```

The browser test builds and smoke-tests one real encrypted Automerge document. It does not prove multi-peer convergence, persistence across restart, or invitation delivery. Continue with the [verified quick start](site/src/content/docs/getting-started/quick-start.mdx) for an interactive run and the exact evidence boundaries.

## Packages

| Workspace | Purpose |
| --- | --- |
| `@swarmbase/collabswarm` | Core document, storage, networking, crypto, ACL, and key-management primitives |
| `@swarmbase/collabswarm-automerge` | Automerge adapter and headless daemon |
| `@swarmbase/collabswarm-yjs` | Yjs adapter and headless daemon |
| `@swarmbase/collabswarm-react` | React context and hooks |
| `@swarmbase/collabswarm-redux` | Redux actions and reducers |
| `@swarmbase/collabswarm-index` | Local/blind indexes, Bloom-filter gossip, and query bindings |

The historical source-directory basename `collabswarm` remains in package paths. All current package names use `@swarmbase/*`. Registry publication has not happened; release tooling validates the packed tarballs in a clean external consumer.

## Architecture and evidence

Swarmbase composes CRDT providers with Helia/IPFS content-addressed storage and libp2p discovery, pubsub, browser transports, and relay fallback. Changes can be signed and encrypted; ACL, UCAN, epoch, BeeKEM, and welcome-message primitives have focused tests.

Those implemented primitives do not establish every end-to-end product flow. Invitation acceptance and persisted KEM state, revocation across hostile peers, restart recovery, partition/rejoin convergence, pinning/restore, relay failover, and distributed search still need stronger integration evidence. Some networking paths require relay or Docker infrastructure.

See the [feature and verification audit](docs/feature-audit.md), [concepts](site/src/content/docs/concepts/), and [limitations](site/src/content/docs/concepts/limitations.md) before making capability claims.

## Examples

- [`examples/browser-test`](examples/browser-test) — minimal Automerge/Redux document app
- [`examples/wiki-swarm`](examples/wiki-swarm) — Automerge collaborative editor
- [`examples/password-manager`](examples/password-manager) — Yjs/React access-control UI

`yarn test:e2e` builds and smoke-tests all three Vite examples. They are development examples, not complete end-to-end showcases.

## Project links

- [Questions and ideas](https://github.com/swarmbase/swarmbase/discussions)
- [Bugs and actionable work](https://github.com/swarmbase/swarmbase/issues)
- [Contributing guide](site/src/content/docs/community/contributing.md)
- [Help wanted](site/src/content/docs/community/help-wanted.md)
- [Security policy](site/src/content/docs/community/index.md#security-reports)

For suspected vulnerabilities, use private vulnerability reporting from the repository **Security** tab. Do not disclose them in public issues or discussions.

## License

Swarmbase and all six package manifests use the [MIT License](LICENSE).
