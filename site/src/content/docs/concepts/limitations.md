---
title: Limitations
description: What Swarmbase cannot do yet, where it can lose data, and when you should use a different database. Read this before building on it.
---

Every database has limitations; most bury them in a FAQ. We would rather you read them first. Swarmbase is built on genuinely young technology — distributed-web databases are a new category — and trust is earned by being straight about where the edges are. Everything on this page is a known, current limitation. If one of them is a dealbreaker for you today, we'd rather you find out now — and if one of them is a problem you'd enjoy working on, we'd love the help.

## Alpha software — not for production

Swarmbase is in **active alpha development**. The core APIs are still being nailed down, test coverage is growing but incomplete, and there has been **no independent security audit** of the [cryptographic design](../security/) or its implementation. It is not appropriate for production workloads, heavy usage, or data you cannot afford to lose. The current goal is to release something good enough to explore real use cases and learn from them — not to carry your company's uptime.

## Data loss is possible without pinning

This is the sharpest edge, so here it is without cushioning: **if all clients holding a document lose their local storage and no pinning service is configured, that data is permanently gone.** There is no server-side copy, because there is no server.

Browser storage makes this a realistic failure mode, not a theoretical one — cleared site data, private browsing, storage eviction under disk pressure, or simply a small group of users all replacing their devices. Until you have set up [pinning](../storage/), treat Swarmbase like venture investing: only put in what you can afford to lose. Making pinning easier (and eventually offering turnkey options) is on the roadmap, but today it is manual setup you must do yourself.

## Browsers behind NAT need a relay

"Peer-to-peer" does not mean "zero infrastructure." Browsers cannot accept inbound connections, and NATs and firewalls block many direct paths, so every real-world deployment needs at least one publicly reachable **bootstrap/relay node** (libp2p Circuit Relay v2) for peers to find each other and to carry traffic when direct WebRTC fails — which is common on corporate networks and symmetric NATs. The relay is small, cheap, and [never sees plaintext](../networking/), but it is a piece of infrastructure you must run, monitor, and pay for. If relays are unreachable, peers that don't already have a direct connection cannot sync.

## Not battle-tested at scale

Swarmbase has not been proven with large documents, large swarms, high transaction rates, or long-lived heavy usage. Benchmarking is future work; the current test coverage is unit and integration level, not soak testing under production-shaped load. Concretely, that means undiscovered failure modes are likely in areas like GossipSub mesh behavior at scale, sync performance on very large histories, and browser storage limits. The development philosophy is to prioritize performance, reliability, and security over new features — but that work is in progress, not done.

## CRDT history grows

Every edit adds a node to the document's [Merkle-DAG](../storage/): storage, sync-message size, and new-peer load time all grow with total edits, and at the CRDT layer deletions leave permanent tombstones — heavily edited documents grow with operations performed, not final content size. [Snapshot-based compaction](../crdts/) exists to bound sync and load costs, but it is **opt-in, disabled by default, and new code** — and it does not shrink tombstone overhead inside the live document state. Long-lived, high-churn documents will get slower and heavier until compaction matures.

## Revocation cannot rewind

Removing a reader [rotates the document key](../security/) so they cannot decrypt anything *new*. It cannot claw back what their device already decrypted. This is a fundamental property of any end-to-end-encrypted replicated system, not a temporary gap — but it surprises people, so it belongs on this list.

## Metadata is visible

Contents are end-to-end encrypted; *patterns* are not. Untrusted peers and relays can see document topic names (which by default embed the document path), which peers participate in which documents, message sizes and timing, and when keys rotate. If your threat model includes traffic analysis, Swarmbase alone is [not sufficient](../security/).

## When another database is a better choice

Use something else when:

- **You need global real-time consistency.** Payments, inventory, reservations — anything where replicas briefly disagreeing is a correctness bug. The distributed web is asynchronous by nature; Swarmbase guarantees [convergence](../crdts/), not instantaneous agreement. Use a conventional transactional database.
- **Your dataset is very large with a high transaction rate.** Unbounded history plus not-battle-tested equals the wrong tool. Use a server-side database built for throughput.
- **You need high-uptime production guarantees now.** Alpha software, self-run relays, manual pinning. A managed database gives you SLAs; we give you honesty.
- **A central authority must control the data.** E2E encryption and replica-owned data are the point of [local-first](../local-first/); if your requirements are centralized audit, retention enforcement, and deletion on demand, a centralized system matches them better.

Swarmbase's sweet spot remains what it was designed for: local-first, collaborative applications for individuals and small-to-medium groups, resilient to bad connectivity, private by default.

## Help us shrink this page

We consider it a feature that this page exists — and a goal to make it shorter. Every item above is a tractable engineering problem, and this is an MIT-licensed open-source project: benchmarking, compaction hardening, pinning tooling, relay ergonomics, security review, and testing are all areas where contributions move the needle. See [how to help](../../community/help-wanted/), or open an issue or discussion on [GitHub](https://github.com/swarmbase/swarmbase) — comments and requests on any of these limitations are explicitly welcome.
