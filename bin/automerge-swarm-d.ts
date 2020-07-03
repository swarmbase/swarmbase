#!/usr/bin/env ts-node --files=bin/automerge-swarm.d.ts

import { AutomergeSwarmNode } from '../src';

const swarmNode = new AutomergeSwarmNode();
console.log('Node:', swarmNode);
console.log('Starting node...');
swarmNode.start();
