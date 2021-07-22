#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { YjsACLProvider, YjsJSONSerializer, YjsKeychainProvider, YjsProvider } from '../src';

global.crypto = require('crypto').webcrypto;

console.log('Creating a new swarm node...');
const crdt = new YjsProvider();
const serializer = new YjsJSONSerializer();
const auth = new SubtleCrypto();
const acl = new YjsACLProvider();
const keychain = new YjsKeychainProvider();
crypto.subtle
  .generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  )
  .then(key => {
    const swarmNode = new CollabswarmNode(key, crdt, serializer, serializer, serializer, auth, acl, keychain);
    console.log('Starting node...');
    swarmNode.start();
  });
