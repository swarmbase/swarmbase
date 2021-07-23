#!/usr/bin/env node

import { CollabswarmNode, SubtleCrypto } from '@collabswarm/collabswarm';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src';
import {
  AutomergeACLProvider,
  AutomergeKeychainProvider,
} from '../src/collabswarm-automerge';

const crypto: Crypto = require('crypto').webcrypto;
global.crypto = crypto;

console.log('Creating a new swarm node...');
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const auth = new SubtleCrypto();
const acl = new AutomergeACLProvider();
const keychain = new AutomergeKeychainProvider();
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
    const swarmNode = new CollabswarmNode(
      keypair.privateKey,
      keypair.publicKey,
      crdt,
      serializer,
      serializer,
      serializer,
      auth,
      acl,
      keychain,
    );
    console.log('Starting node...');
    swarmNode.start();
  });
