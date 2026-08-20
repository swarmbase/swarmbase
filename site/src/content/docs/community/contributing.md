---
title: Contributing to Swarmbase
description: Set up the repository, run the correct validation, and prepare a focused Swarmbase contribution.
---

Swarmbase is alpha software. Discuss non-trivial, architecture-changing, or security-sensitive work before implementation. Questions and early ideas belong in [Discussions](https://github.com/swarmbase/swarmbase/discussions); reproducible bugs and actionable proposals belong in [Issues](https://github.com/swarmbase/swarmbase/issues). Suspected vulnerabilities must use private vulnerability reporting from the repository **Security** tab, never a public issue or discussion.

## Setup

Use Node.js **22.19.0** and Yarn **4.5.0**, as pinned by `.tool-versions` and `package.json`.

```sh
git clone https://github.com/swarmbase/swarmbase.git
cd swarmbase
corepack enable
yarn install --immutable
```

The ten root workspaces are six libraries under `packages/`, three Vite examples under `examples/`, and `site/`. `relay-server/` and `e2e/test-app/` are separate projects with their own manifests and lockfiles; they are not root workspaces.

Current workspace package names use `@swarmbase/*`. They are not published to npm, so develop and test against repository workspaces only.

## Repository map

| Path | Purpose |
| --- | --- |
| `packages/collabswarm/` | Core documents, storage, networking, crypto, ACL, UCAN, epoch, and BeeKEM primitives |
| `packages/collabswarm-{automerge,yjs}/` | CRDT adapters; both contain headless daemon binaries |
| `packages/collabswarm-{react,redux,index}/` | Framework bindings and distributed-index primitives |
| `examples/{browser-test,wiki-swarm,password-manager}/` | Vite applications used by the three smoke suites |
| `site/` | Astro Starlight documentation and TypeDoc integration |
| `relay-server/` | Separate relay project and unit suite |
| `e2e/integration/` | Playwright transport integration and NAT specs using `e2e/test-app/` |
| `e2e/test-app/` | Separate minimal browser project for integration topologies |
| `e2e/swarmbase-nat.spec.ts` | Real Swarmbase cross-NAT acceptance spec |
| `docker-compose.integration.yaml` | Integration service topology |
| `docker-compose.nat-test.yaml` | isolated transport NAT topology |
| `docker-compose.swarmbase-nat.yaml` | Two isolated browsers and real Swarmbase apps |
| `docs/feature-audit.md` | Capability-to-evidence audit and known end-to-end gaps |

There is no `multi-user.spec.ts`; the current example suites are smoke tests, not complete multi-user showcases.

## Build and test commands

```sh
yarn build                         # six library workspaces
yarn build:examples                # libraries, then all three Vite examples
yarn test                          # six library Jest suites
yarn test:relay                    # separate relay-server Jest suite
yarn workspace @swarmbase/site build
yarn exec playwright install chromium
yarn test:e2e                     # three Vite example smoke suites; no Docker
```

Use `yarn exec playwright install chromium --with-deps` when Linux system browser dependencies are also needed.

The benchmark sources currently have a runner module mismatch. Do not present `yarn benchmark:all` as working until that is fixed; benchmark work should also define repeatable budgets.

## Docker-backed suites

The test command alone does not create the required service topology. GitHub CI is the canonical sequence.

```sh
docker compose -f docker-compose.integration.yaml build
docker compose -f docker-compose.integration.yaml up -d
yarn test:integration
docker compose -f docker-compose.integration.yaml down -v


docker compose -f docker-compose.nat-test.yaml build
docker compose -f docker-compose.nat-test.yaml up -d
yarn test:nat
docker compose -f docker-compose.nat-test.yaml down -v


docker compose -f docker-compose.swarmbase-nat.yaml up -d --build
yarn test:swarmbase-nat
docker compose -f docker-compose.swarmbase-nat.yaml down -v
```

Integration checks transport discovery, bidirectional messaging, resilience, and NAT behavior through the test app. Cross-NAT checks encrypted document retrieval between real Swarmbase apps; it does not prove invitation delivery or live post-load convergence.

## Generated API reference

The **Site** workflow runs `yarn workspace @swarmbase/site build`. Starlight TypeDoc generates package API Markdown during that build into `site/src/content/docs/reference/api/`; the directory is ignored. Do not edit generated Markdown. Change exported source comments or `site/astro.config.mjs`, then rebuild the site. There is no legacy TypeDoc workflow.

## Pull request expectations

- Keep commits and pull requests focused. Add regression tests for fixes and focused adversarial tests for security-sensitive behavior.
- Never expose or log credentials, signing keys, KEM keys, document keys, private payloads, or other secrets.
- Preserve wire compatibility deliberately: serializer, protocol, key, ACL, and persistence changes need migration/compatibility analysis.
- Run the relevant commands locally and report evidence without overstating what it proves.
- Address review findings. Repository policy expects Copilot review to return no comments on the latest head and all applicable CI checks to pass.
- Use normal project-style commit messages. Do not add automatic co-author or AI-attribution trailers unless the contributor explicitly requests them.

The CI workflow runs the six-package build and unit-test matrix, Docker integration, NAT traversal, and real Swarmbase cross-NAT jobs. The separate Site workflow builds generated TypeDoc and the site. CI currently does **not** run the three example smoke suites or `test:relay`; run those locally when relevant unless the workflows are changed.

Review timing depends on maintainer availability; there is no response or review-time SLA.

## License metadata

The root `LICENSE` is MIT, while package manifests currently say ISC. This inconsistency must be reconciled before publication; do not describe the packages as having one unqualified license until then.
