#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { YjsACLProvider, YjsJSONSerializer, YjsKeychainProvider, YjsProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer, auth, acl, keychain);
console.log('Starting node...');
swarmNode.start();
