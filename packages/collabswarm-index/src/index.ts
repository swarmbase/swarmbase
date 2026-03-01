// Types
export type {
  IndexFieldType,
  IndexFieldDefinition,
  IndexDefinition,
  FilterOperator,
  FieldFilter,
  SortClause,
  QueryOptions,
  QueryResultEntry,
  QueryResult,
  DocumentSnapshotExtractor,
  BenchmarkResult,
} from './types';

// Field extraction
export { extractField } from './field-extractor';

// Storage layer
export type { IndexStorage, IndexEntry } from './index-storage';
export { MemoryIndexStorage } from './memory-index-storage';
export { IDBIndexStorage } from './idb-index-storage';

// Index manager
export { IndexManager } from './index-manager';

// Integration with CollabswarmDocument
export {
  CollabswarmIndexIntegration,
} from './collabswarm-index-integration';
export type { SubscribableDocument } from './collabswarm-index-integration';

// Blind index (encrypted search)
export type { BlindIndexProvider } from './blind-index-provider';
export { SubtleBlindIndexProvider } from './subtle-blind-index-provider';
export { BlindIndexQuery } from './blind-index-query';
export type { BlindIndexEntry } from './blind-index-query';

// Bloom filter (distributed discovery)
export { BloomFilterCRDT } from './bloom-filter-crdt';
export { BloomFilterGossip } from './bloom-filter-gossip';
export type { PeerFilterState, BloomFilterGossipConfig } from './bloom-filter-gossip';

