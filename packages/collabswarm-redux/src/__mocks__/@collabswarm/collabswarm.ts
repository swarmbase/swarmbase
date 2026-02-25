// Mock for @collabswarm/collabswarm - provides stub exports
// so jest doesn't need to resolve the full libp2p dependency chain.

export class Collabswarm {
  constructor(..._args: any[]) {}
}

export class CollabswarmDocument {
  document: any = {};
  constructor(..._args: any[]) {}
}

export interface CRDTProvider {}
export interface AuthProvider {}
export interface ACLProvider {}
export interface KeychainProvider {}
export interface ChangesSerializer {}
export interface SyncMessageSerializer {}
export interface LoadMessageSerializer {}
export interface CollabswarmConfig {}

export function defaultConfig(..._args: any[]) {
  return {};
}
export function defaultBootstrapConfig(..._args: any[]) {
  return {};
}
