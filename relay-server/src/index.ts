import { createLibp2p } from 'libp2p'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@libp2p/gossipsub'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { listenAddresses, loadConfig } from './config.js'
import { shouldAutoSubscribe } from './topic-policy.js'

async function main() {
  const config = loadConfig()
  const {
    peerDiscoveryTopic,
    documentPublishPath,
    topicAllowlist,
    maxAutoTopics,
    extraTopics,
  } = config

  const libp2p = await createLibp2p({
    addresses: {
      listen: listenAddresses(config),
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
        topics: [peerDiscoveryTopic],
      }),
    },
  })

  // Subscribe to peer discovery and document publish topics.
  // The relay must be subscribed to these topics to forward messages between
  // browser peers that are connected to the relay but not yet to each other.
  libp2p.services.pubsub.subscribe(peerDiscoveryTopic)
  libp2p.services.pubsub.subscribe(documentPublishPath)

  // Auto-subscribe to document topics as peers join them.
  // When a browser peer subscribes to a document topic (e.g. /document/my-doc),
  // the relay also subscribes so it can relay messages between peers that
  // haven't formed a direct WebRTC connection yet. This makes the relay
  // self-sufficient — no manual topic configuration is needed.
  //
  // Hardening controls (configured via environment variables):
  //   TOPIC_ALLOWLIST — comma-separated prefixes; only matching topics are
  //     auto-subscribed. Unset = open mode (all non-system topics allowed).
  //     Example: TOPIC_ALLOWLIST="/document/,/documents"
  //   MAX_AUTO_TOPICS — hard cap on auto-subscribed topics (default 1000).
  //     Once reached, new subscriptions are skipped and a warning is logged
  //     for each rejected topic (see CapReached handling below).
  // The actual policy decision lives in `topic-policy.ts` as a pure function
  // so it can be unit-tested without a libp2p stack.
  //
  // All topics the relay is subscribed to (seed + extra + auto).
  const trackedTopics = new Set<string>([
    peerDiscoveryTopic,
    documentPublishPath,
  ])
  // Topics that were auto-subscribed (not seed or EXTRA_TOPICS).
  // Only these are eligible for auto-unsubscribe and counted toward the cap.
  const autoTopics = new Set<string>()

  libp2p.services.pubsub.addEventListener('subscription-change', (event: any) => {
    const { peerId, subscriptions } = event.detail
    for (const sub of subscriptions) {
      if (!sub.subscribe) {
        continue
      }
      const decision = shouldAutoSubscribe(sub.topic, {
        allowlist: topicAllowlist,
        maxAutoTopics,
        autoTopicCount: autoTopics.size,
        isTracked: (t) => trackedTopics.has(t),
      })
      if (decision.action === 'skip') {
        if (decision.reason === 'CapReached') {
          console.warn(`Auto-subscribe cap reached (${maxAutoTopics}), ignoring topic: ${sub.topic}`)
        }
        continue
      }
      trackedTopics.add(sub.topic)
      autoTopics.add(sub.topic)
      libp2p.services.pubsub.subscribe(sub.topic)
      console.log(`Auto-subscribed to topic: ${sub.topic} (triggered by peer ${peerId}, ${autoTopics.size}/${maxAutoTopics})`)
    }
  })

  // Clean up auto-subscribed topics when all peers leave them.
  // Only auto-subscribed topics are eligible — seed and EXTRA_TOPICS are permanent.
  libp2p.services.pubsub.addEventListener('subscription-change', (event: any) => {
    const { subscriptions } = event.detail
    for (const sub of subscriptions) {
      if (sub.subscribe || !autoTopics.has(sub.topic)) {
        continue
      }
      // Check if any peers are still subscribed via GossipSub.
      const subscribers = (libp2p.services.pubsub as any).getSubscribers?.(sub.topic)
      if (subscribers && subscribers.length === 0) {
        trackedTopics.delete(sub.topic)
        autoTopics.delete(sub.topic)
        libp2p.services.pubsub.unsubscribe(sub.topic)
        console.log(`Auto-unsubscribed from topic: ${sub.topic} (no remaining subscribers)`)
      }
    }
  })

  console.log(
    'Subscribed to topics:',
    peerDiscoveryTopic,
    documentPublishPath,
  )

  // Subscribe to additional topics from environment (comma-separated).
  // Useful for integration tests or pre-configured deployments.
  for (const topic of extraTopics) {
    if (!trackedTopics.has(topic)) {
      trackedTopics.add(topic)
      libp2p.services.pubsub.subscribe(topic)
      console.log(`Subscribed to extra topic: ${topic}`)
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
