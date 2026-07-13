---
title: What we need help with
description: Concrete areas where Swarmbase needs contributors right now — from access control and encryption to docs, testing, and benchmarks — and where each one lives in the code.
---

Swarmbase is in active alpha development, and the roadmap is public: the README's "working on" list is, quite literally, this page. Below is each area translated into something you can actually pick up, with a pointer to where it lives in the repo. Setup instructions are in the [contributing guide](../contributing/).

If you want a gentle entry point, look for issues tagged [`good-first-issue`](https://github.com/swarmbase/swarmbase/issues) on GitHub — those are scoped to be finishable without knowing the whole codebase. Not sure where you fit? [Open a discussion](https://github.com/swarmbase/swarmbase/discussions) and say what you're interested in.

## Dynamic access control

**Why it matters:** letting a changing group of people share encrypted documents — adding and removing readers and writers, rotating keys on revocation — is Swarmbase's central promise, and the part that most distinguishes it from plain CRDT sync. It is also the hardest part to get right.

**Where it lives:** `packages/collabswarm/src` — `acl.ts`, `acl-provider.ts`, `acl-chain.ts`, `capabilities.ts`, and `ucan.ts` for permissions; the `beekem/` directory plus the `beekem-*.ts` modules for group key management (welcomes, revocation, epochs); `keychain.ts` and `group-key-provider.ts` for key handling. Design notes in `notes/auth.md`.

**Good contributions:** reviewing the security model, adding adversarial test cases, improving revocation edge-case handling, or just reading the design notes and filing sharp questions.

## Document encryption and key management

**Why it matters:** Swarmbase stores data on untrusted peers, so every change is signed and encrypted end-to-end. Correctness here is non-negotiable, and more eyes on the crypto plumbing directly increases how much anyone can trust the project.

**Where it lives:** `packages/collabswarm/src` — `auth-provider.ts` (the signing/encryption interface), `auth-subtlecrypto.ts` (the WebCrypto implementation), `ecies.ts`, and `derive-doc-key.ts`.

**Good contributions:** test vectors, cross-browser WebCrypto quirks, performance work (see benchmarking below), and documentation of the threat model.

## Nailing the core API

**Why it matters:** the alpha window is when API mistakes are still cheap to fix. Once people build on `Collabswarm` and `CollabswarmDocument`, every awkward signature becomes permanent. Real-world feedback now shapes the 1.0 surface.

**Where it lives:** `packages/collabswarm/src` — `collabswarm.ts`, `collabswarm-document.ts`, `collabswarm-config.ts`, and the provider interfaces (`crdt-provider.ts`, `auth-provider.ts`, `acl-provider.ts`). The React (`packages/collabswarm-react`) and Redux (`packages/collabswarm-redux`) bindings are the API most app developers actually touch.

**Good contributions:** build a small app with Swarmbase and report every point of friction. "This method confused me" is a genuinely valuable issue.

## Tutorials and working examples

**Why it matters:** local-first, peer-to-peer databases are a new mental model. Most developers' first ten minutes decide whether they stay. The three examples exist, but there's no guided path from zero to a working app.

**Where it lives:** `examples/browser-test` (minimal JSON editor), `examples/wiki-swarm` (collaborative wiki), `examples/password-manager` (shared secrets with a permissions table — the best showcase of access control). Longer-form material belongs in `guides/` and on this site.

**Good contributions:** a step-by-step "build a shared todo list" tutorial, polishing an existing example, or a new small example that shows off a feature the current ones don't (e.g. the indexing package).

## Documentation

**Why it matters:** API docs are generated from TSDoc comments (published via the `typedoc` workflow), so every comment you improve shows up in the docs automatically — and much of the codebase is still thinly commented.

**Where it lives:** doc comments throughout `packages/*/src`; the TypeDoc setup in `packages/collabswarm` (`yarn workspace @swarmbase/collabswarm doc`); design notes in `notes/`; this site itself.

**Good contributions:** documenting one public class or interface well, fixing inaccuracies, or turning a `notes/*.md` design note into a proper guide.

## More testing

**Why it matters:** a database people trust with their data needs far more coverage than an alpha typically has. The maintainers list "more testing" twice in the roadmap — once for now and once for the future. That's not an accident.

**Where it lives:** unit tests sit next to their modules in each package (`*.test.ts`); Playwright suites in `e2e/` and `e2e/integration/` cover multi-user sync, peer discovery, resilience, and NAT traversal (see the [test matrix](../contributing/#test-matrix)); `notes/testing.md` describes the approach.

**Good contributions:** tests for uncovered modules, new integration scenarios (three-plus peers, churn, offline/rejoin), and making flaky tests deterministic.

## Benchmarking

**Why it matters:** the project's stated philosophy is to prioritize performance, reliability, and security over new features. That requires numbers. Benchmark suites exist but need more scenarios, more baselines, and tracking over time.

**Where it lives:** `packages/collabswarm/src/__benchmarks__` (crypto overhead, CRDT sync latency, convergence simulation) and `packages/collabswarm-index/src/__benchmarks__` (blind-index performance, Bloom-filter and query scaling). Run everything with `yarn benchmark:all`.

**Good contributions:** new benchmark scenarios, comparisons across document sizes and peer counts, or automation that surfaces regressions in CI.

## Distributed indexing and queries

**Why it matters:** querying encrypted documents without decrypting them everywhere is what makes Swarmbase a *database* rather than just a sync layer. The `collabswarm-index` package (blind indexes, Bloom-filter gossip) is young and has room for both correctness and performance work.

**Where it lives:** `packages/collabswarm-index/src` — `index-manager.ts`, `blind-index-query.ts`, `bloom-filter-gossip.ts`, and the storage backends (`memory-index-storage.ts`, `idb-index-storage.ts`).

## No code required

Some of the most valuable contributions right now involve writing no code at all:

- **Test on weird networks.** Run the examples across real NATs, corporate firewalls, mobile hotspots, flaky Wi-Fi, or between continents, and report what happens. The Docker NAT simulation is good; reality is better.
- **Report your use case.** Tell us what you'd want to build with a local-first encrypted database — it directly shapes API priorities. [Discussions](https://github.com/swarmbase/swarmbase/discussions) is the place.
- **Review the docs.** Read the README or this site as a newcomer and file an issue for everything that confused you.
- **File great bug reports.** A reproducible bug report with steps and console output is a gift.

Whatever you pick, say hello in an issue or discussion first — the maintainers are actively looking for contributors and will help you find the right-sized piece.
