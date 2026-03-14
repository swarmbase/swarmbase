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

// Default document publish path (matches collabswarm-config.ts default).
// The relay subscribes to this so it can relay document publish notifications
// between browser peers that haven't yet formed a direct WebRTC mesh.
const DOCUMENT_PUBLISH_PATH = process.env.DOCUMENT_PUBLISH_PATH || '/documents'

// Configurable listen addresses via environment variables.
const WS_PORT = process.env.WS_PORT || '9001'
const TCP_PORT = process.env.TCP_PORT || '9002'
const WS_LISTEN = process.env.WS_LISTEN || `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`
const TCP_LISTEN = process.env.TCP_LISTEN || `/ip4/0.0.0.0/tcp/${TCP_PORT}`

async function main() {
  const libp2p = await createLibp2p({
    addresses: {
      listen: [WS_LISTEN, TCP_LISTEN],
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

  // Subscribe to peer discovery and document publish topics.
  // The relay must be subscribed to these topics to forward messages between
  // browser peers that are connected to the relay but not yet to each other.
  libp2p.services.pubsub.subscribe(PUBSUB_PEER_DISCOVERY_TOPIC)
  libp2p.services.pubsub.subscribe(DOCUMENT_PUBLISH_PATH)

  // Auto-subscribe to document topics as peers join them.
  // When a browser peer subscribes to a document topic (e.g. /document/my-doc),
  // the relay also subscribes so it can relay messages between peers that
  // haven't formed a direct WebRTC connection yet. This makes the relay
  // self-sufficient — no manual topic configuration is needed.
  const trackedTopics = new Set<string>([
    PUBSUB_PEER_DISCOVERY_TOPIC,
    DOCUMENT_PUBLISH_PATH,
  ])

  libp2p.services.pubsub.addEventListener('subscription-change', (event: any) => {
    const { peerId, subscriptions } = event.detail
    for (const sub of subscriptions) {
      if (sub.subscribe && !trackedTopics.has(sub.topic)) {
        trackedTopics.add(sub.topic)
        libp2p.services.pubsub.subscribe(sub.topic)
        console.log(`Auto-subscribed to topic: ${sub.topic} (triggered by peer ${peerId})`)
      }
    }
  })

  console.log(
    'Subscribed to topics:',
    PUBSUB_PEER_DISCOVERY_TOPIC,
    DOCUMENT_PUBLISH_PATH,
  )

  // Subscribe to additional topics from environment (comma-separated).
  // Useful for integration tests or pre-configured deployments.
  const extraTopics = process.env.EXTRA_TOPICS
  if (extraTopics) {
    for (const topic of extraTopics.split(',').map(t => t.trim()).filter(Boolean)) {
      if (!trackedTopics.has(topic)) {
        trackedTopics.add(topic)
        libp2p.services.pubsub.subscribe(topic)
        console.log(`Subscribed to extra topic: ${topic}`)
      }
    }
  }

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

  // Log peer connections for debugging.
  libp2p.addEventListener('peer:connect', (event) => {
    console.log('Peer connected:', event.detail.toString())
  })
  libp2p.addEventListener('peer:disconnect', (event) => {
    console.log('Peer disconnected:', event.detail.toString())
  })

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
