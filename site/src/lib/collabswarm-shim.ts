// Minimal re-export of the light @swarmbase/collabswarm modules needed in the
// browser bundle. The package's full barrel pulls in libp2p/Helia (and their
// ESM-only dependencies), which the landing page doesn't need — the sync demo
// only exercises the CRDT serialization and crypto providers. The site's Vite
// config aliases bare `@swarmbase/collabswarm` imports to this module.
export {
  describeValue,
  serializeChangeNodeForJSON,
  deserializeChangeNodeFromJSON,
} from '@swarmbase/collabswarm/src/merkle-dag-serialization';
export {
  JSONSerializer,
  validateChangeBlockMetadata,
} from '@swarmbase/collabswarm/src/json-serializer';
export { LRUCache } from '@swarmbase/collabswarm/src/lru-cache';
export { TIPS_HASH_LENGTH } from '@swarmbase/collabswarm/src/tips-hash';
export { SubtleCrypto } from '@swarmbase/collabswarm/src/auth-subtlecrypto';
