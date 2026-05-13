import { Collabswarm, CollabswarmPeersHandler } from './collabswarm';
import {
  CollabswarmConfig,
  DEFAULT_WEBRTC_ICE_SERVERS,
  IceServer,
  defaultConfig,
  defaultBootstrapConfig,
  getDefaultConfig,
} from './collabswarm-config';
import {
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  HistoryVisibility,
} from './collabswarm-document';
import { CRDTSyncMessage } from './crdt-sync-message';
// CollabswarmNode is intentionally excluded from this barrel export.
// It is a Node-only module (imports `fs`, `@libp2p/mdns` which depends on
// `dgram`) and must not be bundled by browser consumers. Import it from the
// dedicated Node subpath export:
//   import { CollabswarmNode, defaultNodeConfig } from '@collabswarm/collabswarm/node';
import { CRDTProvider } from './crdt-provider';
import { SyncMessageSerializer } from './sync-message-serializer';
import { ChangesSerializer } from './changes-serializer';
import { JSONSerializer, validateChangeBlockMetadata } from './json-serializer';
import { SubtleCrypto } from './auth-subtlecrypto';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { ACL } from './acl';
import { Keychain, keychainHistorySinceOrFull } from './keychain';
import { requireSerializePublicKey } from './auth-provider';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTChangeBlock } from './crdt-change-block';
import {
  CRDTChangeNodeKind,
  CRDTChangeNodeDeferred,
  CRDTChangeNode,
  crdtChangeNodeDeferred,
} from './crdt-change-node';
import {
  CRDTChangeNodeWire,
  describeValue,
  serializeChangeNodeForJSON,
  deserializeChangeNodeFromJSON,
} from './merkle-dag-serialization';
import {
  EPOCH_ID_LENGTH,
  GCM_NONCE_LENGTH,
  EPOCH_SECRET_INFO,
  ENCRYPTION_KEY_INFO,
  Epoch,
  EpochTransition,
  toHex,
  generateEpochId,
  deriveEpochSecret,
  deriveEncryptionKey,
  createEpoch,
  EpochManager,
} from './epoch';
import {
  GroupKeyAgreementOutput,
  WelcomeMessage,
  MembershipProposal,
  GroupKeyProvider,
} from './group-key-provider';
import {
  CAP_DOC_ADMIN,
  CAP_DOC_WRITE,
  CAP_DOC_READ,
  CAP_DOC_HISTORY,
  CAPABILITY_HIERARCHY,
  NON_HIERARCHICAL_CAPABILITIES,
  capabilityImplies,
  isFieldCapability,
  getFieldPath,
} from './capabilities';
import {
  createUCAN,
  verifyUCANSignature,
  validateUCANChain,
  serializeUCAN,
  deserializeUCAN,
} from './ucan';
import {
  UCANACL,
  UCANACLProvider,
} from './ucan-acl';
import {
  ACLChain,
  canonicalEntryPayload,
  computeEntryHash,
} from './acl-chain';
import { NetworkStats } from './network-stats';
import { LRUCache } from './lru-cache';
import {
  beekemPathUpdateV1,
  beekemWelcomeV1,
  bloomFilterUpdateV1,
  tipAdvertiseV1,
} from './wire-protocols';
import {
  DOC_KEY_INFO,
  deriveDocumentKeyFromRootSecret,
  deriveEpochIdFromRootSecret,
} from './derive-doc-key';
import {
  SerializedPathNodeUpdate,
  SerializedPathUpdate,
  deserializePathUpdateFromWire,
  serializePathUpdateForWire,
} from './path-update-wire';
import { tipsHash, tipsHashToHex, TIPS_HASH_LENGTH } from './tips-hash';
import {
  decideLoadQuorum,
  effectiveK,
  effectiveQ,
  LoadQuorumFailedError,
  LoadQuorumFailedReason,
  validateLoadQuorumConfig,
} from './load-quorum';
import { documentTopic, DEFAULT_DOCUMENT_TOPIC_PREFIX } from './document-topic';
import type { CRDTSnapshotNode } from './snapshot-node';
import type { CompactionConfig } from './compaction-config';
import { defaultCompactionConfig } from './compaction-config';

export * from './beekem';

export {
  ACL,
  ACLProvider,
  SubtleCrypto,
  Collabswarm,
  CollabswarmPeersHandler,
  CollabswarmConfig,
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  HistoryVisibility,
  CRDTChangeBlock,
  CRDTChangeNodeKind,
  CRDTChangeNodeDeferred,
  CRDTChangeNode,
  crdtChangeNodeDeferred,
  CRDTChangeNodeWire,
  describeValue,
  serializeChangeNodeForJSON,
  deserializeChangeNodeFromJSON,
  CRDTSyncMessage,
  CRDTProvider,
  ChangesSerializer,
  EPOCH_ID_LENGTH,
  GCM_NONCE_LENGTH,
  EPOCH_SECRET_INFO,
  ENCRYPTION_KEY_INFO,
  Epoch,
  EpochTransition,
  toHex,
  generateEpochId,
  deriveEpochSecret,
  deriveEncryptionKey,
  createEpoch,
  EpochManager,
  GroupKeyAgreementOutput,
  WelcomeMessage,
  MembershipProposal,
  GroupKeyProvider,
  Keychain,
  keychainHistorySinceOrFull,
  KeychainProvider,
  requireSerializePublicKey,
  SyncMessageSerializer,
  LoadMessageSerializer,
  JSONSerializer,
  validateChangeBlockMetadata,
  defaultConfig,
  defaultBootstrapConfig,
  getDefaultConfig,
  DEFAULT_WEBRTC_ICE_SERVERS,
  IceServer,
  // Capabilities
  CAP_DOC_ADMIN,
  CAP_DOC_WRITE,
  CAP_DOC_READ,
  CAP_DOC_HISTORY,
  CAPABILITY_HIERARCHY,
  NON_HIERARCHICAL_CAPABILITIES,
  capabilityImplies,
  isFieldCapability,
  getFieldPath,
  // UCAN
  createUCAN,
  verifyUCANSignature,
  validateUCANChain,
  serializeUCAN,
  deserializeUCAN,
  // UCAN ACL
  UCANACL,
  UCANACLProvider,
  // ACL chain-of-trust
  ACLChain,
  canonicalEntryPayload,
  computeEntryHash,
  // Wire protocols
  bloomFilterUpdateV1,
  beekemWelcomeV1,
  beekemPathUpdateV1,
  tipAdvertiseV1,
  // BeeKEM document-key derivation
  DOC_KEY_INFO,
  deriveDocumentKeyFromRootSecret,
  deriveEpochIdFromRootSecret,
  // BeeKEM PathUpdate wire serialization
  serializePathUpdateForWire,
  deserializePathUpdateFromWire,
  // Initial-load quorum (#189 §5.4.2)
  tipsHash,
  tipsHashToHex,
  TIPS_HASH_LENGTH,
  decideLoadQuorum,
  effectiveK,
  effectiveQ,
  LoadQuorumFailedError,
  LoadQuorumFailedReason,
  validateLoadQuorumConfig,
  // Compaction
  defaultCompactionConfig,
  // Network statistics
  NetworkStats,
  // Utilities
  documentTopic,
  DEFAULT_DOCUMENT_TOPIC_PREFIX,
  LRUCache,
};

export type { NetworkStatsSnapshot } from './network-stats';
export type {
  PeerTipAdvertisement,
  LoadQuorumDecision,
} from './load-quorum';

// Re-export types
export type { AuthProvider, AesAlgorithmName } from './auth-provider';
export type { SerializedPathUpdate, SerializedPathNodeUpdate } from './path-update-wire';
export type { DocumentCapability } from './capabilities';
export type { UCAN, UCANCapability, UCANPayload } from './ucan';
export type { UCANACLEntry } from './ucan-acl';
export type { CRDTSnapshotNode } from './snapshot-node';
export type { CompactionConfig } from './compaction-config';
export type {
  ACLChainConfig,
  ACLChainOps,
  ACLChainVerifyError,
  ACLChainVerifyResult,
  ACLEntry,
  ACLState,
  SerializePublicKey,
} from './acl-chain';
