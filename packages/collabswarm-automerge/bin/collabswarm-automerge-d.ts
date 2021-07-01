#!/usr/bin/env node

import { CollabswarmNode, CryptoKeySerializer, SubtleCrypto } from '@collabswarm/collabswarm';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const auth = new SubtleCrypto();
const keySerializer = new CryptoKeySerializer({ name: "AES-GCM" }, ["encrypt", "decrypt"]);
const swarmNode = new CollabswarmNode(crdt, serializer, serializer, auth, keySerializer);
console.log('Starting node...');
swarmNode.start();
