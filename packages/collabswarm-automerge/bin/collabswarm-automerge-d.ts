#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src';
import { AutomergeACLProvider, AutomergeKeychainProvider } from '../src/collabswarm-automerge';

console.log('Creating a new swarm node...');
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const auth = new SubtleCrypto();
const acl = new AutomergeACLProvider();
const keychain = new AutomergeKeychainProvider();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer, auth, acl, keychain);
console.log('Starting node...');
swarmNode.start();
