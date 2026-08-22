#!/usr/bin/env node

import {
  defaultBootstrapConfig,
  SubtleCrypto,
} from '@peerborne/core';
import {
  PeerborneNode,
  defaultNodeConfig,
} from '@peerborne/core/node';
import { AutomergeJSONSerializer, AutomergeProvider } from '../src/index.js';
import {
  AutomergeACLProvider,
  AutomergeKeychainProvider,
} from '../src/peerborne-automerge.js';

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
      name: 'ECDSA',
      namedCurve: 'P-384',
    },
    true,
    ['sign', 'verify'],
  )
  .then((keypair) => {
    const swarmNode = new PeerborneNode(
      keypair.privateKey,
      keypair.publicKey,
      crdt,
      serializer,
      serializer,
      serializer,
      auth,
      acl,
      keychain,
      defaultNodeConfig(defaultBootstrapConfig([])),
    );
    console.log('Starting node...');
    swarmNode.start();
  });
