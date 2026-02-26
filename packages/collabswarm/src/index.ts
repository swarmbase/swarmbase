import { Collabswarm, CollabswarmPeersHandler } from './collabswarm';
import {
  CollabswarmConfig,
  defaultConfig,
  defaultBootstrapConfig,
} from './collabswarm-config';
import {
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  HistoryVisibility,
} from './collabswarm-document';
import { CRDTSyncMessage } from './crdt-sync-message';
import { CollabswarmNode, defaultNodeConfig } from './collabswarm-node';
import { CRDTProvider } from './crdt-provider';
import { SyncMessageSerializer } from './sync-message-serializer';
import { ChangesSerializer } from './changes-serializer';
import { JSONSerializer } from './json-serializer';
import { AuthProvider } from './auth-provider';
import { SubtleCrypto } from './auth-subtlecrypto';
import { ACLProvider } from './acl-provider';
import { KeychainProvider } from './keychain-provider';
import { ACL } from './acl';
import { Keychain } from './keychain';
import { LoadMessageSerializer } from './load-request-serializer';
import { CRDTChangeBlock } from './crdt-change-block';
import {
  CRDTChangeNodeKind,
  CRDTChangeNodeDeferred,
  CRDTChangeNode,
  crdtChangeNodeDeferred,
} from './crdt-change-node';
import {
  EPOCH_ID_LENGTH,
  NONCE_LENGTH,
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
import { bloomFilterUpdateV1 } from './wire-protocols';

export * from './beekem';

export {
  ACL,
  ACLProvider,
  AuthProvider,
  SubtleCrypto,
  Collabswarm,
  CollabswarmPeersHandler,
  CollabswarmConfig,
  CollabswarmDocument,
  CollabswarmDocumentChangeHandler,
  HistoryVisibility,
  CollabswarmNode,
  CRDTChangeBlock,
  CRDTChangeNodeKind,
  CRDTChangeNodeDeferred,
  CRDTChangeNode,
  crdtChangeNodeDeferred,
  CRDTSyncMessage,
  CRDTProvider,
  ChangesSerializer,
  EPOCH_ID_LENGTH,
  NONCE_LENGTH,
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
  KeychainProvider,
  SyncMessageSerializer,
  LoadMessageSerializer,
  JSONSerializer,
  defaultConfig,
  defaultBootstrapConfig,
  defaultNodeConfig,
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
  // Wire protocols
  bloomFilterUpdateV1,
};

// Re-export types
export type { DocumentCapability } from './capabilities';
export type { UCAN, UCANCapability, UCANPayload } from './ucan';
export type { UCANACLEntry } from './ucan-acl';
