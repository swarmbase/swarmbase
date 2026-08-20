import { createHelia, createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withLibp2pLight } from '@helia/libp2p';
import type { HeliaWithLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import type { ServiceMap } from '@libp2p/interface';
// libp2p v3 retired `@libp2p/pubsub`, so use the concrete service type.
import type { GossipSub } from '@libp2p/gossipsub';
import { isLibp2p } from 'libp2p';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';
import type { CollabswarmConfig } from './collabswarm-config.js';
import { closeLegacyHeliaStores, openLegacyHeliaStores } from './store-lifecycle.js';
import type { OpenableStore } from './store-lifecycle.js';

export type CollabswarmHeliaNode = HeliaWithLibp2p<
  ServiceMap & { pubsub: GossipSub }
>;

interface StartedHeliaNode {
  heliaNode: CollabswarmHeliaNode;
  openedLegacyStores: OpenableStore[];
}

export async function createAndStartHeliaNode(
  heliaInit?: NonNullable<CollabswarmConfig['helia']>,
): Promise<StartedHeliaNode> {
  const openedLegacyStores = heliaInit
    ? await openLegacyHeliaStores(heliaInit.datastore, heliaInit.blockstore)
    : [];
  let heliaNode: CollabswarmHeliaNode | undefined;

  try {
    const {
      libp2p: libp2pInit,
      bitswap: bitswapInit,
      ...heliaOptions
    } = heliaInit ?? {};
    if (isLibp2p(libp2pInit)) {
      throw new Error(
        'Helia 7 requires libp2p creation options; preconfigured libp2p nodes are not supported',
      );
    }
    heliaNode = (
      libp2pInit
        ? withBitswap(
            withLibp2pLight(
              createHeliaLight({
                ...heliaOptions,
                codecs: [
                  dagCbor,
                  dagJson,
                  json,
                  ...(heliaOptions.codecs ?? []),
                ],
                hashers: [sha512, ...(heliaOptions.hashers ?? [])],
              }),
              libp2pInit,
            ),
            bitswapInit,
          )
        : createHelia({ ...heliaOptions, bitswap: bitswapInit })
    ) as CollabswarmHeliaNode;
    await heliaNode.start();
    if (!heliaNode.libp2p.services.pubsub) {
      throw new Error(
        'Helia node must be initialized with a pubsub service (e.g., gossipsub)',
      );
    }

    return { heliaNode, openedLegacyStores };
  } catch (error) {
    try {
      await heliaNode?.stop();
    } catch {
      // Best-effort cleanup preserves the startup error.
    }
    await closeLegacyHeliaStores(openedLegacyStores);
    throw error;
  }
}
