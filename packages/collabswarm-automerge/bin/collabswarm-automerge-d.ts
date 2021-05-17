#!/usr/bin/env node

import { CollabswarmNode } from '@collabswarm/collabswarm';
import { AutomergeProvider } from '../src';

console.log('Creating a new swarm node...');
const swarmNode = new CollabswarmNode(new AutomergeProvider);
console.log('Starting node...');
swarmNode.start();
