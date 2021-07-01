#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const auth = new SubtleCrypto();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer, auth);
console.log('Starting node...');
swarmNode.start();
