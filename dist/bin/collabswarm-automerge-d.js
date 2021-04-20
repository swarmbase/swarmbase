#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = require("../src");
console.log('Creating a new swarm node...');
const swarmNode = new src_1.AutomergeSwarmNode();
console.log('Starting node...');
swarmNode.start();
//# sourceMappingURL=collabswarm-automerge-d.js.map