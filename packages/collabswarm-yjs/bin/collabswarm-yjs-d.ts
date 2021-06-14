#!/usr/bin/env node

import { CollabswarmNode } from '@collabswarm/collabswarm';
import { YjsJSONSerializer, YjsProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer);
console.log('Starting node...');
swarmNode.start();
