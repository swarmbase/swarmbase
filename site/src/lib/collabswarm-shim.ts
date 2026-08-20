// Minimal re-export of the light @swarmbase/collabswarm modules needed in the
// browser bundle. The package's full barrel pulls in libp2p/Helia (and their
// ESM-only dependencies), which the landing page doesn't need — the sync demo
// only exercises the CRDT serialization and crypto providers. The site's Vite
// config aliases bare `@swarmbase/collabswarm` imports to this module.
export {
  describeValue,
  serializeChangeNodeForJSON,
  deserializeChangeNodeFromJSON,
  JSONSerializer,
  validateChangeBlockMetadata,
  LRUCache,
  TIPS_HASH_LENGTH,
  SubtleCrypto,
} from '@swarmbase/collabswarm/browser-primitives';
