#!/usr/bin/env node

import { CollabswarmNode } from '@collabswarm/collabswarm';
import { YjsProvider } from '../src';

console.log('Creating a new swarm node...');
const swarmNode = new CollabswarmNode(new YjsProvider);
console.log('Starting node...');
swarmNode.start();
