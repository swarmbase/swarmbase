# GitHub Copilot Instructions for SwarmDB

## Project Overview

SwarmDB (formerly Collabswarm) is a distributed web document database with dynamic access control and strong eventual consistency. It's designed for local-first, collaborative applications that work on untrusted networks.

### Core Technologies

- **CRDTs (Conflict-Free Replicated Data Types)**: Using Yjs for conflict-free document synchronization
- **libp2p**: For peer discovery, connection management, and transport (WebRTC, WebSockets, TCP)
- **IPFS**: Content-addressed storage for data integrity and availability
- **GossipSub Protocol**: Efficient peer-to-peer message exchange
- **TypeScript**: Primary language for all packages

### Key Architecture Principles

1. **Local-First**: Changes are applied locally first, then propagated to peers
2. **Eventual Consistency**: CRDTs ensure all nodes converge to the same state without consensus
3. **Private Data**: Documents are encrypted with dynamic access control lists (ACLs)
4. **Decentralized**: No central server required, though pinning services can be used

## Repository Structure

This is a **monorepo** using Yarn workspaces:

```
swarmbase/
├── packages/
│   ├── collabswarm/          # Core library
│   ├── collabswarm-automerge/ # Automerge CRDT integration
│   ├── collabswarm-yjs/       # Yjs CRDT integration
│   ├── collabswarm-react/     # React bindings
│   └── collabswarm-redux/     # Redux integration
├── examples/
│   ├── browser-test/          # Basic browser example
│   ├── wiki-swarm/            # Wiki application example
│   └── password-manager/      # Password manager example
└── notes/                     # Design docs and notes
```

### Core Package (`packages/collabswarm`)

Key files and their purposes:

- `collabswarm.ts`: Main entry point, manages IPFS node and documents
- `collabswarm-document.ts`: Document management, change handling, sync
- `collabswarm-node.ts`: Node configuration and libp2p setup
- `crdt-provider.ts`: Interface for CRDT implementations
- `auth-provider.ts`: Cryptographic operations interface
- `auth-subtlecrypto.ts`: WebCrypto API implementation
- `acl.ts` / `acl-provider.ts`: Access control list management
- `keychain.ts` / `keychain-provider.ts`: Encryption key management
- `wire-protocols.ts`: Protocol identifiers for document operations

## Development Workflow

### Installation

```bash
yarn install
```

This installs all dependencies for all workspaces.

### Building

Build a specific workspace:

```bash
yarn workspace @collabswarm/collabswarm tsc
yarn workspace @collabswarm/collabswarm-automerge tsc
yarn workspace @collabswarm/collabswarm-yjs tsc
yarn workspace @collabswarm/collabswarm-react tsc
yarn workspace @collabswarm/collabswarm-redux tsc
```

### Testing

Run tests for a specific workspace:

```bash
yarn workspace @collabswarm/collabswarm test
```

**Testing Philosophy**: Use table-driven testing with Jest for better coverage and maintainability. See `notes/testing.md` for reference.

### Docker

Build and run examples with Docker:

```bash
docker-compose build
docker-compose up
```

### Documentation

Generate TypeDoc documentation:

```bash
yarn workspace @collabswarm/collabswarm doc
```

## Code Style and Conventions

### TypeScript

- Use TypeScript 4.9.5 (check `packages/collabswarm/package.json`)
- Enable strict type checking
- Export types and interfaces from package index files
- Use generics for provider interfaces to maintain type safety

### Naming Conventions

- **Classes**: PascalCase (e.g., `CollabswarmDocument`, `SubtleCrypto`)
- **Interfaces**: PascalCase, often ending with `Provider` for plugin interfaces (e.g., `CRDTProvider`, `AuthProvider`)
- **Files**: kebab-case matching class name (e.g., `collabswarm-document.ts`)
- **Private members**: Prefix with underscore (e.g., `_document`, `_pubsubHandler`)
- **Protocol strings**: Use constants (e.g., `documentLoadV1`, `documentKeyUpdateV1`)

### Generic Type Parameters

Common pattern for document types:

```typescript
<DocType, ChangesType, ChangeFnType, PrivateKey, PublicKey, DocumentKey>
```

### Error Handling

- Log warnings for authentication/verification failures
- Use `console.log` for protocol-level events
- Throw errors for programming mistakes, log warnings for runtime issues

## Testing Practices

### Table-Driven Testing

Use Jest with table-driven approach for comprehensive test coverage:

```typescript
describe.each([
  [input1, expected1],
  [input2, expected2],
  [input3, expected3],
])('test suite', (input, expected) => {
  test(`should handle ${input}`, () => {
    // test logic
  });
});
```

Reference: https://dev.to/flyingdot/data-driven-unit-tests-with-jest-26bh

### Test Files

- Place test files alongside source: `auth-subtlecrypto.test.ts`
- Use `.test.ts` extension
- Mock external dependencies (WebCrypto, libp2p, IPFS)

## Security and Cryptography

### Authentication and Authorization

1. **User Identity**: Users identified by public key pairs
2. **ACLs**: Each document has read and write access control lists
3. **Signing**: Changes are signed with private keys
4. **Verification**: Recipients verify signatures against ACL public keys
5. **Encryption**: Documents encrypted with AES-GCM symmetric encryption

### Key Management

- **User Keys**: Long-term identity keys (public/private key pairs)
- **Document Keys**: Symmetric keys for document encryption
- **Key Rotation**: When removing access, generate new document key and re-encrypt

### Cryptographic Algorithms

- **Symmetric Encryption**: AES-GCM (96-bit IV, 128-bit tag)
- **Signing**: ECDSA with P-256 curve (recommended)
- **Key Derivation**: As needed for key management

### Security Best Practices

1. Never log or transmit private keys
2. Always verify signatures before applying remote changes
3. Use secure random number generation for IVs and keys
4. Implement proper key rotation when revoking access
5. Encrypt sensitive data before storing in IPFS

See `notes/auth.md` and `notes/automerge-db-security.md` for detailed flows.

## Common Patterns

### Creating a Document

```typescript
const doc = await collabswarm.create<DocType>(
  documentPath,
  initialState,
  crdtProvider,
  authProvider,
  aclProvider,
  keychainProvider
);
```

### Opening an Existing Document

```typescript
const doc = await collabswarm.open<DocType>(
  documentPath,
  crdtProvider,
  authProvider,
  aclProvider,
  keychainProvider
);
```

### Handling Document Changes

```typescript
doc.registerRemoteChangeHandler('handlerId', (doc, publicKey) => {
  // Handle remote changes
});

doc.registerLocalChangeHandler('handlerId', (doc, publicKey) => {
  // Handle local changes
});
```

### Making Changes

```typescript
doc.change((doc) => {
  // Modify document using CRDT-specific API
  // Changes are automatically signed, encrypted, and broadcast
});
```

### Managing Access

```typescript
// Add writer
await doc.addWriter(publicKey);

// Remove writer (triggers key rotation)
await doc.removeWriter(publicKey);

// Add reader
await doc.addReader(publicKey);

// Remove reader (triggers key rotation)
await doc.removeReader(publicKey);
```

## Provider Interfaces

### CRDTProvider

Implement for new CRDT backends:

```typescript
interface CRDTProvider<DocType, ChangesType, ChangeFnType> {
  // Initialize empty document
  init(): DocType;
  
  // Clone document
  clone(doc: DocType): DocType;
  
  // Create change from function
  change(doc: DocType, fn: ChangeFnType): [DocType, ChangesType];
  
  // Apply changes to document
  applyChanges(doc: DocType, changes: ChangesType): DocType;
  
  // Merge changes
  merge(changes1: ChangesType, changes2: ChangesType): ChangesType;
}
```

### AuthProvider

Implement for different cryptographic backends:

```typescript
interface AuthProvider<PrivateKey, PublicKey, DocumentKey> {
  // Generate key pairs
  generateKeyPair(): Promise<{ privateKey: PrivateKey; publicKey: PublicKey }>;
  
  // Sign data
  sign(data: Uint8Array, privateKey: PrivateKey): Promise<Uint8Array>;
  
  // Verify signature
  verify(data: Uint8Array, signature: Uint8Array, publicKey: PublicKey): Promise<boolean>;
  
  // Encrypt with document key
  encrypt(data: Uint8Array, key: DocumentKey): Promise<Uint8Array>;
  
  // Decrypt with document key
  decrypt(data: Uint8Array, key: DocumentKey): Promise<Uint8Array>;
  
  // Key management
  generateDocumentKey(): Promise<DocumentKey>;
  exportKey(key: DocumentKey): Promise<Uint8Array>;
  importKey(data: Uint8Array): Promise<DocumentKey>;
}
```

## Known Limitations and Gotchas

### Data Persistence

- **Browser storage**: Data can be lost if all clients clear browser storage
- **Pinning**: Set up IPFS pinning service for persistent storage
- **Mitigation**: Use remote pinning or dedicated IPFS node

### Transport Layer

- **WebRTC Star**: Current browser-to-browser requires signaling server
- **NAT/Firewall**: May need relay nodes for some connections
- **Future**: Migration to more decentralized WebRTC transports planned

### Performance

- **CRDT History**: Performance degrades with document history growth
- **Compaction**: Not yet implemented, planned for future
- **Best For**: Small-to-medium documents with moderate change rates

### Consistency Model

- **Asynchronous**: No global real-time consistency guarantees
- **Eventual**: All nodes eventually converge to same state
- **Not Suitable**: Applications requiring immediate global consistency

### Development Status

- **Alpha**: Not production-ready, expect breaking changes
- **Testing**: Limited battle-testing with large datasets
- **Use Cases**: Experiments, prototypes, small-scale deployments

## Wire Protocols

Current protocol versions in `wire-protocols.ts`:

- `documentLoadV1`: `/collabswarm/doc-load/1.0.0` - Initial document loading
- `documentKeyUpdateV1`: `/collabswarm/key-update/1.0.0` - Key rotation updates

When implementing new protocols:
1. Define constant in `wire-protocols.ts`
2. Use semantic versioning: `/namespace/operation/version`
3. Implement handler in `collabswarm-document.ts`
4. Register with libp2p in document lifecycle methods

## Debugging Tips

### Enable Verbose Logging

libp2p and IPFS have debug logging:

```bash
DEBUG=libp2p:* npm start
DEBUG=ipfs:* npm start
```

### Common Issues

1. **"Cannot verify signature"**: Check ACL contains correct public keys
2. **"Failed to decrypt"**: Key may not be in keychain, check access permissions
3. **Peer connection fails**: Check NAT/firewall, may need relay node
4. **Changes not syncing**: Verify GossipSub subscription, check network connectivity

### Testing Locally

Use multiple browser windows/tabs to test peer discovery and sync. For better testing, use different browsers to simulate truly independent peers.

## Contributing Guidelines

### Before Making Changes

1. Understand the distributed nature of the system
2. Consider security implications (especially for auth/ACL changes)
3. Maintain backward compatibility with wire protocols
4. Add tests for new functionality
5. Update TypeDoc comments for public APIs

### Pull Request Checklist

- [ ] TypeScript compiles without errors (`yarn workspace <name> tsc`)
- [ ] Tests pass (`yarn workspace <name> test`)
- [ ] Code follows existing style conventions
- [ ] Public APIs have TypeDoc comments
- [ ] Security implications considered and documented
- [ ] Wire protocol changes versioned appropriately

## Resources

### External Documentation

- [CRDTs Explained](https://www.serverless.com/blog/crdt-explained-supercharge-serverless-at-edge/)
- [Yjs Documentation](https://docs.yjs.dev/)
- [libp2p Concepts](https://docs.libp2p.io/concepts/)
- [IPFS Documentation](https://docs.ipfs.tech/)
- [GossipSub Spec](https://github.com/libp2p/specs/tree/master/pubsub/gossipsub)
- [Local-First Software](https://martin.kleppmann.com/papers/local-first.pdf)

### Internal Documentation

- `notes/testing.md` - Testing practices
- `notes/auth.md` - Authentication flows and diagrams
- `notes/automerge-db-security.md` - Security design
- `notes/automerge-db-replication.md` - Replication strategy
- `README.md` - Project overview and philosophy

## Quick Command Reference

```bash
# Install dependencies
yarn install

# Build specific package
yarn workspace @collabswarm/collabswarm tsc

# Run tests
yarn workspace @collabswarm/collabswarm test

# Generate docs
yarn workspace @collabswarm/collabswarm doc

# Run example via Docker
docker-compose build
docker-compose up

# Watch mode for development
yarn workspace @collabswarm/collabswarm tsc-watch
```

## When Contributing Code

### For Core Library Changes

- Understand CRDT semantics and eventual consistency
- Preserve type safety throughout the generic type chain
- Consider performance implications (every change is signed and encrypted)
- Test with multiple peers to verify sync behavior

### For New Features

- Start with a design document in `notes/`
- Consider security implications first
- Ensure backward compatibility with existing documents
- Add comprehensive tests including multi-peer scenarios

### For Bug Fixes

- Add regression test first
- Verify fix doesn't break existing functionality
- Consider edge cases (offline peers, concurrent changes, etc.)
- Update documentation if behavior changes

---

**Remember**: SwarmDB is designed for untrusted networks and asynchronous operation. Always consider security, eventual consistency, and peer discovery when making changes.
