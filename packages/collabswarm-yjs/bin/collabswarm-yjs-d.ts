#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { YjsJSONSerializer, YjsProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer, auth);
console.log('Starting node...');
swarmNode.start();
