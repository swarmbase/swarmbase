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
      name: "ECDSA",
      namedCurve: "P-384",
    },
    true,
    ["sign", "verify"]
  )
  .then(keypair => {
    const swarmNode = new CollabswarmNode(keypair.privateKey, keypair.publicKey, crdt, serializer, serializer, serializer, auth, acl, keychain);
    console.log('Starting node...');
    swarmNode.start();
  });
