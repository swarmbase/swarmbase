import { Keychain } from './keychain';

export interface KeychainProvider<KeychainChange, DocumentKey> {
  initialize(): Keychain<KeychainChange, DocumentKey>;
}
