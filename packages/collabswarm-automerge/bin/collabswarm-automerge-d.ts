#!/usr/bin/env node

import { CollabswarmNode } from '@collabswarm/collabswarm';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src';

console.log('Creating a new swarm node...');
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const swarmNode = new CollabswarmNode(crdt, serializer, serializer);
console.log('Starting node...');
swarmNode.start();
