import { createLibp2p } from 'libp2p'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PUBSUB_PEER_DISCOVERY_TOPIC = 'swarmdb._peer-discovery._p2p._pubsub'
const SYNC_TOPIC = '/swarmdb/integration-test/sync'

async function main() {
  const libp2p = await createLibp2p({
    addresses: {
      listen: [
        '/ip4/0.0.0.0/tcp/9001/ws',
        '/ip4/0.0.0.0/tcp/9002',
      ],
    },
    transports: [
      webSockets(),
      tcp(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyDialMultiaddr: async () => false,
    },
    services: {
      identify: identify(),
      autoNat: autoNAT(),
      relay: circuitRelayServer(),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        canRelayMessage: true,
        floodPublish: true,
      }),
      pubsubPeerDiscovery: pubsubPeerDiscovery({
        topics: [PUBSUB_PEER_DISCOVERY_TOPIC],
      }),
    },
  })

  libp2p.services.pubsub.subscribe(PUBSUB_PEER_DISCOVERY_TOPIC)
  libp2p.services.pubsub.subscribe(SYNC_TOPIC)
  console.log('Subscribed to topics:', PUBSUB_PEER_DISCOVERY_TOPIC, SYNC_TOPIC)

  const peerId = libp2p.peerId.toString()
  const multiaddrs = libp2p.getMultiaddrs().map((ma) => ma.toString())
  const wsMultiaddr = multiaddrs.find((ma) => ma.includes('/ws/')) ?? multiaddrs[0]

  console.log('PeerId:', peerId)
  console.log('Multiaddrs:', multiaddrs)

  const relayInfo = {
    peerId,
    multiaddrs,
    wsMultiaddr,
  }

  const sharedDir = '/shared'
  const outputPath = fs.existsSync(sharedDir)
    ? path.join(sharedDir, 'relay-info.json')
    : path.join(process.cwd(), 'relay-info.json')

  fs.writeFileSync(outputPath, JSON.stringify(relayInfo, null, 2))
  console.log('Relay info written to:', outputPath)

  const shutdown = async () => {
    console.log('Shutting down relay server...')
    await libp2p.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('Failed to start relay server:', err)
  process.exit(1)
})
