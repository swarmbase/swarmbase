#!/usr/bin/env node

import { AutomergeSwarmNode } from '../src';

console.log('Creating a new swarm node...');
const swarmNode = new AutomergeSwarmNode();
console.log('Starting node...');
swarmNode.start();
