# SwarmDB Technical Specifications

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [CRDT Layer](#3-crdt-layer)
4. [Networking Layer](#4-networking-layer)
5. [Security & Cryptography](#5-security--cryptography)
6. [Serialization & Wire Protocol](#6-serialization--wire-protocol)
7. [Y.js Schema Design Guide](#7-yjs-schema-design-guide)
8. [Theoretical Foundations & Citations](#8-theoretical-foundations--citations)
9. [Homomorphic Encryption Assessment](#9-homomorphic-encryption-assessment)
10. [Next Steps & Roadmap](#10-next-steps--roadmap)

---

## 1. System Overview

### 1.1 What SwarmDB Is

SwarmDB is an open-source TypeScript library implementing a distributed web (dweb) document database. It provides:

- **Conflict-free eventual consistency** via CRDTs (Yjs or Automerge)
- **Dynamic access control** with read/write ACLs enforced cryptographically
- **Document encryption** using AES-GCM with automatic key rotation
- **Browser-first P2P networking** via libp2p (WebRTC, WebSockets, WebTransport)
- **Content-addressed storage** via IPFS/Helia with Merkle-DAG change history
- **Local-first editing** with opportunistic synchronization

### 1.2 Design Principles

1. **No central server required** - peers discover each other via DHT and bootstrap nodes
2. **Asynchronous by design** - operates on untrusted networks with intermittent connectivity
3. **Pluggable CRDT backends** - generic type system supports Yjs, Automerge, or custom implementations
4. **Security-first** - all changes are signed and encrypted before transmission
5. **Local-first responsiveness** - writes are local, then propagated

### 1.3 Known Limitations

- Alpha status: not battle-tested for production
- Data can be lost if all clients clear storage and no pinning service is configured
- Browser-to-browser requires signaling/relay infrastructure for NAT traversal
- CRDT history grows unbounded (compaction not yet implemented)
- Performance degrades with very large documents or high change rates

---

## 2. Architecture

### 2.1 Package Structure

| Package | Purpose | Key Classes |
|---------|---------|-------------|
| `@collabswarm/collabswarm` | Core library | `Collabswarm`, `CollabswarmDocument`, `SubtleCrypto` |
| `@collabswarm/collabswarm-yjs` | Yjs CRDT provider | `YjsProvider`, `YjsACL`, `YjsKeychain` |
| `@collabswarm/collabswarm-automerge` | Automerge CRDT provider | `AutomergeProvider`, `AutomergeACL` |
| `@collabswarm/collabswarm-react` | React integration | `CollabswarmContext`, `useCollabswarm` |
| `@collabswarm/collabswarm-redux` | Redux integration | Redux middleware and reducers |

### 2.2 Core Class Relationships

```
Collabswarm (main entry)
 ├── manages IPFS/Helia node lifecycle
 ├── creates/opens CollabswarmDocument instances
 ├── tracks peer connections via libp2p
 └── CollabswarmDocument
      ├── CRDTProvider (pluggable: Yjs or Automerge)
      ├── AuthProvider (signing, verification, encryption)
      ├── ACLProvider (read/write permission lists)
      ├── KeychainProvider (document key management)
      ├── ChangesSerializer (CRDT ↔ bytes)
      └── SyncMessageSerializer (wire format)
```

### 2.3 Data Flow

**Local Change:**
```
User → document.change(fn)
     → CRDTProvider.localChange() produces delta
     → ChangesSerializer.serialize(delta)
     → AuthProvider.sign(serialized, privateKey)
     → AuthProvider.encrypt(signed, documentKey)
     → GossipSub.publish(topic, encrypted)
     → IPFS.store(encrypted) for Merkle-DAG
```

**Remote Change:**
```
GossipSub.message(encrypted)
     → AuthProvider.decrypt(encrypted, documentKey)
     → AuthProvider.verify(decrypted, ACL.writers)
     → ChangesSerializer.deserialize(verified)
     → CRDTProvider.remoteChange(delta)
     → notify change handlers
```

**Document Load (new peer joining):**
```
New peer → sends load request to random connected peer
        → receiving peer responds with full Merkle-DAG of changes
        → new peer reconstructs document from change history
        → subscribes to GossipSub topic for future changes
```

### 2.4 Merkle-DAG Change Structure

Document changes are organized as a Merkle-DAG (directed acyclic graph) where:

- Each node (`CRDTChangeNode`) represents a set of changes
- Nodes can be of kind: `'document'`, `'writer'`, `'reader'`
- Children can be deferred (`false`) for lazy loading from IPFS
- The root node represents the current document state
- Enables efficient synchronization by comparing DAG heads

---

## 3. CRDT Layer

### 3.1 CRDTProvider Interface

```typescript
interface CRDTProvider<DocType, ChangesType, ChangeFnType> {
  newDocument(): DocType;
  localChange(document: DocType, message: string, changeFn: ChangeFnType): [DocType, ChangesType];
  remoteChange(document: DocType, changes: ChangesType): DocType;
  getHistory(document: DocType): ChangesType;
}
```

### 3.2 Yjs Implementation

- **DocType:** `Y.Doc`
- **ChangesType:** `Uint8Array` (binary state vector diffs)
- **Key structures:** `Y.Map`, `Y.Array`, `Y.Text`, `Y.XmlFragment`
- **Sync protocol:** Two-step: exchange state vectors, then compute and send deltas
- Uses YATA algorithm for sequence conflict resolution

### 3.3 Automerge Implementation

- **DocType:** `Automerge.Doc<T>`
- **ChangesType:** `BinaryChange[]`
- **Key structures:** JSON-like nested objects, lists, text
- Uses JSON CRDT algorithm (Kleppmann & Beresford)
- Binary change format for compact transmission

---

## 4. Networking Layer

### 4.1 Transport Stack

| Transport | Use Case | Protocol |
|-----------|----------|----------|
| WebRTC | Browser ↔ Browser | SCTP over DTLS over ICE |
| WebSockets | Browser ↔ Node | TCP with HTTP upgrade |
| WebTransport | Modern browser ↔ Node | QUIC-based |
| TCP | Node ↔ Node | Direct TCP |
| Circuit Relay V2 | NAT fallback | Relayed via relay node |

### 4.2 Peer Discovery

- **Bootstrap nodes:** Known initial peers for joining the network
- **Kad-DHT:** Kademlia distributed hash table for ongoing peer discovery
- **GossipSub peer exchange:** Discover peers through pubsub mesh
- **Auto-NAT:** Automatic detection of external addresses

### 4.3 Pub/Sub (GossipSub)

- Topic per document: `/document/{documentId}`
- Strict signature policy enabled for message authentication
- Mesh-based routing with gossip propagation for efficiency
- Attack-resilient design (used in production by Ethereum 2.0 and Filecoin)

### 4.4 Coordination Servers Required

Currently, SwarmDB requires these coordination servers for browser-to-browser operation:

| Server | Purpose | Required? |
|--------|---------|-----------|
| **Bootstrap node** | Initial peer discovery | Yes, at least 1 |
| **Signaling server** | WebRTC session establishment | Yes, for browser-to-browser |
| **Circuit relay node** | NAT traversal fallback | Recommended |
| **STUN server** | NAT type detection, public address discovery | Yes (can use public STUN) |
| **TURN server** | Data relay for symmetric NATs | Optional but recommended |
| **Pinning service** | Data persistence when all peers offline | Optional but recommended |

**Important:** The signaling server and relay nodes are the primary centralized dependencies. LibP2P's WebRTC transport handles signaling through the relay circuit, but at least one relay node must be accessible. Public STUN servers (e.g., Google's) can be used for NAT detection.

---

## 5. Security & Cryptography

### 5.1 Current Implementation

| Function | Algorithm | Details |
|----------|-----------|---------|
| Identity | ECDSA P-384 | Asymmetric key pair per user |
| Signing | ECDSA | Signs all change messages |
| Verification | ECDSA | Verify against ACL writer keys |
| Document Encryption | AES-GCM | 96-bit IV, 128-bit auth tag |
| Key Rotation | AES-GCM | New key when reader/writer removed |

### 5.2 Access Control Model

```
Document
 └── ACL (stored as a CRDT document itself)
      ├── Writers: Set<PublicKey>  (can modify document content)
      └── Readers: Set<PublicKey>  (can decrypt and read document)
```

- Writers can add/remove other writers and readers
- Removing a user triggers key rotation: new document key generated, distributed to remaining authorized users
- ACL changes are themselves CRDT operations (conflict-free)

### 5.3 Trust Model

- Public-key based identity, no centralized PKI
- Users identified by their public keys (not by libp2p peer IDs, which are ephemeral)
- Each change carries a signature verifiable against the ACL
- No quorum or consensus required; CRDT convergence handles conflicts

### 5.4 Security Gaps (Current)

1. **Key distribution:** New document keys must be distributed via secure side-channel (e.g., Signal); no built-in secure key exchange
2. **Initial load trust:** No quorum protocol for verifying initial document state from untrusted peers
3. **Forward secrecy:** Not implemented; compromised key exposes all historical data encrypted with that key
4. **ACL chain of trust:** Full verification of ACL modification history chain not yet implemented
5. **Revocation latency:** Removed users may still have the old key until rotation completes across all peers

---

## 6. Serialization & Wire Protocol

### 6.1 Serialization Layers

```
Application Data
     ↓ CRDTProvider (Yjs binary encoding / Automerge binary changes)
ChangesSerializer (Uint8Array)
     ↓ SyncMessageSerializer (wraps changes + metadata + signature)
CRDTSyncMessage (Uint8Array)
     ↓ AuthProvider.encrypt (AES-GCM)
Encrypted Wire Format (Uint8Array)
     ↓ GossipSub / libp2p stream
Network
```

### 6.2 CRDTSyncMessage Structure

```typescript
interface CRDTSyncMessage<ChangesType> {
  documentId: string;
  changes: CRDTChangeNode<ChangesType>;  // Merkle-DAG tree
  keychainChanges?: KeychainChanges;      // Optional ACL key updates
  signature: Uint8Array;                   // ECDSA signature
}
```

### 6.3 Wire Protocols

| Protocol ID | Direction | Purpose |
|-------------|-----------|---------|
| `/collabswarm/doc-load/1.0.0` | Request/Response | Load full document from peer |
| `/collabswarm/key-update/1.0.0` | Push | Distribute new document keys after ACL change |

---

## 7. Y.js Schema Design Guide

### 7.1 Core Principles

Y.js CRDTs resolve conflicts automatically, but **how** they resolve conflicts depends on which shared types you use and how you structure your data. Schema design is critical for getting the conflict resolution behavior your application needs.

**Key insight:** Y.js is not a generic database. It is a CRDT framework where the data structure IS the conflict resolution strategy.

### 7.2 Available Shared Types

| Type | Behavior | Use When |
|------|----------|----------|
| `Y.Map` | Last-writer-wins per key | Key-value data, settings, metadata |
| `Y.Array` | Positional insertion, no duplicates lost | Ordered lists, task lists, sequences |
| `Y.Text` | Character-level collaborative editing | Rich text, code, prose |
| `Y.XmlFragment` | XML tree with attributes | Rich text editors (ProseMirror, Slate) |

### 7.3 Conflict Resolution Patterns

#### Pattern 1: Last-Writer-Wins Register (Y.Map)

When two users concurrently set the same key, one value wins. Use for settings, status fields, or any atomic value.

```typescript
const doc = new Y.Doc();
const settings = doc.getMap('settings');

// User A sets theme to 'dark'
settings.set('theme', 'dark');

// User B concurrently sets theme to 'light'
settings.set('theme', 'light');

// Result: one wins (determined by client ID ordering)
// This is fine for settings where any valid value is acceptable
```

**When to use:** Configuration, preferences, status flags, any field where the latest value is the correct one.

**Schema example - User Profile:**
```typescript
const profile = doc.getMap('profile');
profile.set('name', 'Alice');       // LWW - last edit wins
profile.set('email', 'a@b.com');    // LWW - last edit wins
profile.set('updatedAt', Date.now()); // LWW - timestamp tracks recency
```

#### Pattern 2: Grow-Only / Add-Wins Set (Y.Map with boolean values)

Use Y.Map where keys represent set members and values are booleans. Deletions can be re-added (add-wins semantics).

```typescript
const doc = new Y.Doc();
const tags = doc.getMap('tags');

// User A adds tag
tags.set('urgent', true);

// User B concurrently removes tag
tags.delete('urgent');

// User A re-adds tag
tags.set('urgent', true);

// Result: 'urgent' exists - add-wins in concurrent scenarios
```

**When to use:** Tags, labels, feature flags, any set where concurrent addition should win over deletion.

#### Pattern 3: Ordered List with Concurrent Inserts (Y.Array)

Y.Array preserves all insertions. Concurrent inserts at the same position are both kept, ordered by the YATA algorithm.

```typescript
const doc = new Y.Doc();
const tasks = doc.getArray('tasks');

// User A inserts task at position 0
tasks.insert(0, [{ id: '1', text: 'Buy groceries', done: false }]);

// User B concurrently inserts task at position 0
tasks.insert(0, [{ id: '2', text: 'Call dentist', done: false }]);

// Result: Both tasks exist. Order determined by YATA (client ID tiebreak).
// No data is lost.
```

**When to use:** Task lists, message threads, ordered collections where all items must be preserved.

**Important caveat:** If array items have mutable properties, nest a Y.Map inside the Y.Array:

```typescript
const tasks = doc.getArray('tasks');
const task = new Y.Map();
task.set('id', '1');
task.set('text', 'Buy groceries');
task.set('done', false);  // This can be independently toggled
tasks.push([task]);

// Later: mark as done (concurrent edits to 'done' resolve via LWW)
task.set('done', true);
```

#### Pattern 4: Collaborative Rich Text (Y.Text)

Y.Text provides character-level conflict resolution. Concurrent edits at different positions merge cleanly. Concurrent edits at the same position interleave characters (YATA ordering).

```typescript
const doc = new Y.Doc();
const content = doc.getText('article');

// User A types "Hello" at position 0
content.insert(0, 'Hello');

// User B concurrently types "World" at position 0
content.insert(0, 'World');

// Result: "HelloWorld" or "WorldHello" (order by client ID)
// Both users' text is preserved
```

**Formatting attributes are also CRDT-aware:**
```typescript
// User A bolds characters 0-5
content.format(0, 5, { bold: true });

// User B concurrently italicizes characters 3-8
content.format(3, 8, { italic: true });

// Result: characters 0-2 bold, 3-5 bold+italic, 6-8 italic
// Formatting merges correctly
```

#### Pattern 5: Nested Documents for Independent Entities (Subdocuments)

Use Y.Doc subdocuments when entities are independent and should be lazily loaded.

```typescript
// Parent document tracks which child docs exist
const index = new Y.Doc();
const docRefs = index.getMap('documents');
docRefs.set('doc-abc', { title: 'Meeting Notes', id: 'doc-abc' });

// Each referenced doc is a separate Y.Doc with its own sync
const meetingNotes = new Y.Doc({ guid: 'doc-abc' });
const text = meetingNotes.getText('content');
```

**When to use:** Collections of independent documents (wiki pages, chat rooms, files). Avoids loading all documents into memory.

#### Pattern 6: Counter via Nested Map (No built-in counter)

Y.js does not have a native counter type. Naive `map.set('count', map.get('count') + 1)` causes lost updates. Use a per-user counter map instead:

```typescript
const doc = new Y.Doc();
const votes = doc.getMap('votes');

// Each user increments their own counter (no conflict possible)
const myCount = votes.get(myUserId) || 0;
votes.set(myUserId, myCount + 1);

// Total count = sum of all user counters
function getTotal(): number {
  let total = 0;
  votes.forEach((count) => { total += count as number; });
  return total;
}
```

**When to use:** Vote counts, view counters, any numeric aggregation.

### 7.4 Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Storing mutable objects in Y.Array as plain JSON | Changes overwrite entire object (LWW on array index) | Use nested Y.Map inside Y.Array |
| Using `map.set('count', count + 1)` | Lost updates under concurrency | Use per-user counter pattern |
| Single huge Y.Map for all data | All data loaded/synced together | Use subdocuments for independent entities |
| Relying on Y.Array index as stable ID | Indexes shift as items are inserted/deleted | Store IDs inside items, look up by ID |
| Frequent delete + re-insert in Y.Array | Creates tombstones, degrades performance | Use Y.Map with `deleted: true` flag instead |

### 7.5 Schema Design Checklist

1. **Identify independent entities** → separate Y.Doc subdocuments
2. **Identify concurrent-editable fields** → Y.Map for atomic values, Y.Text for text
3. **Identify ordered collections** → Y.Array with nested Y.Map for mutable items
4. **Identify counters/aggregates** → per-user counter maps
5. **Consider tombstone growth** → prefer soft-delete flags over array removal for frequently toggled items
6. **Test concurrent scenarios** → simulate two users editing simultaneously

---

## 8. Theoretical Foundations & Citations

### 8.1 CRDT Theory

**[1] Shapiro, M., Preguiça, N., Baquero, C., and Zawirski, M. (2011).** "A comprehensive study of Convergent and Commutative Replicated Data Types." INRIA Research Report RR-7506.
https://inria.hal.science/inria-00555588v1/document
*The definitive CRDT survey. Formalizes state-based (CvRDTs) and operation-based (CmRDTs) approaches with convergence proofs. Presents registers, counters, sets, graphs, and sequences.*

**[2] Shapiro, M., Preguiça, N., Baquero, C., and Zawirski, M. (2011).** "Conflict-Free Replicated Data Types." Proceedings of SSS 2011, LNCS 6976, pp. 386-400.
https://link.springer.com/chapter/10.1007/978-3-642-24550-3_29
*Formal introduction of the term "CRDT" with self-stabilizing convergence proofs.*

**[3] Almeida, P.S., Shoker, A., and Baquero, C. (2018).** "Delta State Replicated Data Types." Journal of Parallel and Distributed Computing, 111, pp. 162-173.
https://arxiv.org/abs/1603.01529
*Delta-state CRDTs combining small message sizes (like op-based) with unreliable channel tolerance (like state-based). This is the theoretical foundation for Yjs's efficient delta synchronization.*

**[4] Kleppmann, M. and Beresford, A.R. (2017).** "A Conflict-Free Replicated JSON Datatype." IEEE Transactions on Parallel and Distributed Systems, 28(10), pp. 2733-2746.
https://arxiv.org/abs/1608.03960
*JSON CRDT algorithm resolving concurrent modifications without data loss. Foundational to Automerge.*

### 8.2 Y.js / YATA Algorithm

**[5] Nicolaescu, P., Jahns, K., Derntl, M., and Klamma, R. (2016).** "Near Real-Time Peer-to-Peer Shared Editing on Extensible Data Types." Proceedings of GROUP '16, pp. 39-49. ACM.
https://dl.acm.org/doi/10.1145/2957276.2957310
*The primary YATA paper. Presents the algorithm ensuring convergence, intention preservation, offline editing support, and extensibility to arbitrary data types in the browser.*

**[6] Nicolaescu, P., Jahns, K., Derntl, M., and Klamma, R. (2015).** "Yjs: A Framework for Near Real-Time P2P Shared Editing on Arbitrary Data Types." Proceedings of ICWE 2015.
https://www.researchgate.net/publication/290390486
*Earlier paper describing the Yjs framework as a practical YATA implementation.*

**[7] Jahns, K. (2019).** "Are CRDTs suitable for shared editing?" Blog post.
https://blog.kevinjahns.de/are-crdts-suitable-for-shared-editing
*Demonstrates that CRDT overhead is minimal even for large documents. Includes reproducible benchmarks.*

### 8.3 Sequence CRDTs

**[8] Oster, G., Urso, P., Molli, P., and Imine, A. (2006).** "Data Consistency for P2P Collaborative Editing." Proceedings of CSCW '06, pp. 259-267. ACM.
https://www.researchgate.net/publication/220878815
*Introduced WOOT (WithOut Operational Transformation), an early sequence CRDT.*

**[9] Roh, H.-G., Jeon, M., Kim, J.-S., and Lee, J. (2011).** "Replicated abstract data types: Building blocks for collaborative applications." Journal of Parallel and Distributed Computing, 71(3), pp. 354-368.
http://csl.skku.edu/papers/jpdc11.pdf
*Introduces Replicated Growable Arrays (RGA) with significant performance improvements.*

**[10] Attiya, H., Burckhardt, S., Gotsman, A., Morrison, A., Yang, H., and Zawirski, M. (2016).** "Specification and Complexity of Collaborative Text Editing." Proceedings of PODC '16.
https://dl.acm.org/doi/10.1145/2933057.2933090
*First precise formal specification of replicated list for collaborative editing.*

### 8.4 Distributed Systems Foundations

**[11] Lamport, L. (1978).** "Time, Clocks, and the Ordering of Events in a Distributed System." Communications of the ACM, 21(7), pp. 558-565.
https://lamport.azurewebsites.net/pubs/time-clocks.pdf
*Foundational paper on logical clocks and "happens-before" partial ordering.*

**[12] Fidge, C.J. (1988).** "Timestamps in Message-Passing Systems That Preserve the Partial Ordering." Proceedings of ACSC '88, pp. 56-66.

**[13] Mattern, F. (1989).** "Virtual Time and Global States of Distributed Systems." Proceedings of the International Workshop on Parallel and Distributed Algorithms, pp. 215-226.
*[12] and [13] independently introduced vector clocks, used in CRDTs for version tracking.*

### 8.5 Operational Transformation (Historical Context)

**[14] Ellis, C.A. and Gibbs, S.J. (1989).** "Concurrency Control in Groupware Systems." Proceedings of SIGMOD '89, pp. 399-407. ACM.
https://dl.acm.org/doi/10.1145/67544.66963
*Foundational OT paper. CRDTs were developed to address OT's complexity and correctness issues.*

### 8.6 LibP2P, IPFS, and P2P Networking

**[15] Benet, J. (2014).** "IPFS - Content Addressed, Versioned, P2P File System." arXiv:1407.3561.
https://arxiv.org/abs/1407.3561
*IPFS whitepaper. LibP2P was extracted from IPFS as a standalone networking stack.*

**[16] Maymounkov, P. and Mazières, D. (2002).** "Kademlia: A Peer-to-Peer Information System Based on the XOR Metric." IPTPS '02, LNCS 2429, pp. 53-65.
https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf
*Foundational DHT paper. LibP2P uses Kademlia-based DHT for peer discovery.*

**[17] Vyzovitis, D., Naber, Y., Dias, D., Psaras, Y., et al. (2020).** "GossipSub: Attack-Resilient Message Propagation in the Filecoin and ETH2.0 Networks."
https://github.com/libp2p/specs/tree/master/pubsub/gossipsub
*GossipSub specification, libp2p's primary pub/sub protocol used by SwarmDB.*

**[18] Sanjuan, H., Poyhtari, S., Teixeira, P., and Psaras, Y. (2020).** "Merkle-CRDTs: Merkle-DAGs meet CRDTs." arXiv:2004.00107.
https://arxiv.org/abs/2004.00107
*Demonstrates how Merkle-DAGs act as logical clocks for CRDTs. Directly relevant to SwarmDB's change history architecture.*

### 8.7 WebRTC and NAT Traversal

**[19] RFC 8445** - Interactive Connectivity Establishment (ICE). https://datatracker.ietf.org/doc/html/rfc8445
**[20] RFC 5389** - STUN. https://datatracker.ietf.org/doc/html/rfc5389
**[21] RFC 5766** - TURN. https://datatracker.ietf.org/doc/html/rfc5766
**[22] RFC 8825** - WebRTC Overview. https://datatracker.ietf.org/doc/html/rfc8825
**[23] RFC 8831** - WebRTC Data Channels. https://datatracker.ietf.org/doc/html/rfc8831

### 8.8 Local-First Software

**[24] Kleppmann, M., Wiggins, A., van Hardenberg, P., and McGranaghan, M. (2019).** "Local-First Software: You Own Your Data, in Spite of the Cloud."
https://martin.kleppmann.com/papers/local-first.pdf
*Defines the local-first paradigm. Directly cited in SwarmDB's README as a design motivation.*

### 8.9 Additional Resources

- **CRDT.tech** - Community resource with papers and implementations: https://crdt.tech/
- **Yjs Documentation** - https://docs.yjs.dev/
- **libp2p Specifications** - https://github.com/libp2p/specs
- **Yrs Architecture** (Rust port of Yjs) - https://www.bartoszsypytkowski.com/yrs-architecture/

---

## 9. Homomorphic Encryption Assessment

### 9.1 Summary Verdict

**Homomorphic encryption (FHE) is not practical for real-time P2P authentication.** Current implementations are 100-1000x slower than equivalent unencrypted operations, with encryption/decryption taking hundreds of milliseconds per operation.

### 9.2 Current FHE Libraries (JS/WASM)

| Library | Encrypt Time | Decrypt Time | Verdict |
|---------|-------------|-------------|---------|
| **node-seal** (MS SEAL WASM) | ~232ms | ~230ms | Too slow for auth handshakes |
| **TFHE-rs** (Zama WASM) | Client-only | No compute in WASM | Not viable |
| **Concrete** (Zama) | ML-focused | N/A for auth | Wrong tool |
| **OpenFHE-WASM** | 1.5-3x native | Sub-500ms under load | Marginal, needs server |

### 9.3 Recommended Alternatives

#### For Authentication: Zero-Knowledge Proofs (ZKPs)

**snarkjs + Circom** - most mature JS/WASM ZKP stack:
- Proof verification: **~1.2ms** (real-time capable)
- Proof generation: **832-1147ms** (acceptable for initial handshake)
- Proof size: 128-192 bytes
- Works in browser via WASM
- npm: `snarkjs` (v0.7.5)

Users prove group membership ("I hold a key authorized by this ACL") without revealing the key itself.

#### For Access Control: Proxy Re-Encryption

**IronCore recrypt-wasm-binding** - proxy re-encryption in WASM:
- Transform keys allow adding users without re-encrypting data
- Removing users = stop generating transform keys
- NCC Group security audit completed
- npm: `@ironcorelabs/recrypt-wasm-binding`

#### For Group Key Management: MLS (Messaging Layer Security)

**mls-rs** (AWS Labs) - RFC 9420 compliant:
- Logarithmic time add/remove members
- Forward secrecy and post-compromise security
- WASM build available
- npm: `@river-build/mls-rs-wasm`

#### For Encrypted CRDTs: p2panda

**p2panda-encryption** + **p2panda-auth** (Rust crates):
- Purpose-built for encrypted CRDTs with decentralized access control
- Uses Signal X3DH for key agreement
- Access Control CRDT (convergent, offline-first)
- NLNet-funded, security audited

### 9.4 Recommended Architecture

```
┌─────────────────────────────┐
│   Authentication            │  snarkjs/Circom ZKPs + DIDs
│   (prove group membership)  │  ~1.2ms verification
├─────────────────────────────┤
│   Access Control CRDT       │  p2panda-auth (Rust/WASM) or
│   (add/remove members)      │  recrypt-wasm-binding (JS)
├─────────────────────────────┤
│   Group Key Management      │  mls-rs (@river-build/mls-rs-wasm)
│   (forward secrecy)         │  RFC 9420 compliant
├─────────────────────────────┤
│   Data Encryption           │  AES-256-GCM (keys from MLS)
│   (at rest and in transit)  │
├─────────────────────────────┤
│   CRDT Sync Layer           │  Yjs / Automerge
│   (conflict resolution)     │  Merkle-DAG change history
└─────────────────────────────┘
```

---

## 10. Next Steps & Roadmap

### 10.1 Helia Migration

**Current state:** The project already imports `helia` (next) but the examples and some core code reference older IPFS patterns.

**Action items:**
1. Audit all `ipfs`/`js-ipfs` imports and replace with Helia equivalents
2. Replace UnixFS usage with `@helia/unixfs` API
3. Update block storage to use `blockstore-idb` / `datastore-idb` (already partially done)
4. Update `Collabswarm.ts` and `CollabswarmDocument.ts` to use Helia's `createHelia()` API
5. Update Docker configurations and examples
6. Test that IPFS content-addressing still works correctly with Helia's CID handling
7. Remove any deprecated `js-ipfs` dependencies

**Key Helia differences from js-ipfs:**
- Helia is modular: you compose functionality from separate packages
- No more `ipfs.add()`; use `@helia/unixfs` for file operations
- Block-level API via `helia.blockstore`
- libp2p is configured separately and passed to `createHelia()`

### 10.2 Integration Testing (Browser-to-Browser Across NAT)

**Goal:** Verify that two browsers on different networks (behind different NATs) can discover each other, connect, and synchronize documents.

**Test architecture:**
```
Browser A (NAT 1) ←→ Relay Node ←→ Browser B (NAT 2)
         ↕                                ↕
    STUN Server                      STUN Server
```

**Action items:**
1. Create a Docker Compose test environment with:
   - Two isolated Docker networks (simulating different NATs)
   - A relay/bootstrap node accessible from both networks
   - A STUN server (or use public Google STUN)
   - Two browser instances (one per network)
2. Write Playwright tests that:
   - Open browser-test app in each browser
   - Create a document in Browser A
   - Open the same document in Browser B
   - Make changes in both browsers
   - Assert both browsers converge to the same state
3. Test failure scenarios:
   - Relay node goes down temporarily → reconnection
   - One browser goes offline → changes sync when back
   - Rapid concurrent edits → CRDT convergence
4. Add CI pipeline for NAT traversal tests (may need specialized infrastructure)

### 10.3 Coordination Server Documentation

Create clear documentation specifying exactly what servers are needed and how to set them up:

**Action items:**
1. Document each coordination server type (see Section 4.4)
2. Provide deployment configurations for each:
   - Bootstrap node: Docker image + config
   - Relay node: Docker image + config
   - Signaling server: Docker image + config (or use libp2p relay circuit)
3. Document public alternatives (STUN servers, hosted relay services)
4. Create a minimal single-server setup guide (all-in-one relay + bootstrap)
5. Create a production multi-server deployment guide
6. Document cost considerations and scaling characteristics

### 10.4 Authentication & Encryption

**Current gaps:** Key distribution via side-channel, no forward secrecy, no initial load verification, incomplete ACL chain-of-trust verification.

**Action items:**
1. **Implement secure key exchange:**
   - Evaluate MLS (`@river-build/mls-rs-wasm`) for group key management
   - Implement key agreement protocol (Signal X3DH or similar)
   - Remove dependency on external side-channel for key distribution
2. **Implement forward secrecy:**
   - Per-message or per-epoch key ratcheting
   - Old keys can decrypt historical data but not future data
3. **Implement ACL chain-of-trust verification:**
   - Verify full chain of ACL modifications on document load
   - Detect and reject forged ACL modifications
4. **Implement initial load quorum:**
   - Request document from multiple peers
   - Compare DAG heads to detect tampered data
5. **Add/remove user flow:**
   - Adding: Generate transform key or distribute document key via MLS
   - Removing: Rotate document key, re-distribute to remaining users via MLS
   - Handle concurrent add/remove conflicts (CRDT-based ACL resolves this)

### 10.5 Indexing Support

**Current state:** Documents are individual, accessed by ID. No cross-document querying.

**Action items:**
1. **Design index architecture:**
   - Local index: Each peer maintains a local index of documents it has access to
   - Index as CRDT: Shared index document that all peers contribute to
   - Secondary indexes: Map field values → document IDs
2. **Implement local indexing:**
   - IndexedDB-based index for browser peers
   - Support for field-level indexing within documents
   - Query API: `swarm.query({ field: 'value' })` returning matching document IDs
3. **Implement distributed index:**
   - Index document as a special CRDT document (Y.Map of field → document set)
   - Index updates propagate via same CRDT sync mechanism
   - Handle index consistency (index may lag behind document changes)
4. **Consider integration with existing tools:**
   - Evaluate `y-indexeddb` for persistent local storage
   - Evaluate `flexsearch` or `lunr` for full-text search on local data

### 10.6 Performance & Compaction

**Action items:**
1. Implement history compaction (truncate change history beyond a threshold)
2. Benchmark CRDT operations for different document sizes
3. Profile memory usage for long-lived documents with many changes
4. Implement lazy loading of change blocks from IPFS (partially done via deferred nodes)

---

*Last updated: 2026-02-24*
