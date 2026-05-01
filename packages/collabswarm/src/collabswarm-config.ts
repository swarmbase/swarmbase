import { HeliaInit } from 'helia';
import { yamux } from '@chainsafe/libp2p-yamux';
import { bootstrap, BootstrapInit } from '@libp2p/bootstrap';
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC, webRTCDirect } from '@libp2p/webrtc';
import { webTransport } from '@libp2p/webtransport';
import { webSockets } from '@libp2p/websockets';
import { all } from '@libp2p/websockets/filters';
import { identify } from '@libp2p/identify';
import { autoNAT } from '@libp2p/autonat';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { kadDHT } from '@libp2p/kad-dht';
import { ipnsSelector } from 'ipns/selector';
import { ipnsValidator } from 'ipns/validator';
import { bitswap } from '@helia/block-brokers';
import { IDBDatastore } from 'datastore-idb';
import { IDBBlockstore } from 'blockstore-idb';
import { CompactionConfig } from './compaction-config';
import { DEFAULT_DOCUMENT_TOPIC_PREFIX } from './document-topic';

/**
 * Default list of free public STUN servers used to populate the WebRTC
 * `iceServers` configuration when none is provided by the consumer.
 *
 * STUN lets peers discover their public IP/port mapping so they can attempt
 * direct browser-to-browser WebRTC connections without depending on a
 * Circuit Relay for data forwarding (issue #236, layered NAT-traversal phase 3).
 *
 * The list is intentionally kept small (3-4 servers across multiple operators)
 * so we get redundancy without flooding ICE gathering with redundant probes.
 *
 * Sources:
 * - Google: `stun.l.google.com:19302` -- the de-facto reference public STUN
 *   server, widely used in WebRTC examples and production apps.
 * - Cloudflare: `stun.cloudflare.com:3478` -- operated by Cloudflare's
 *   public WebRTC infra; geographically diverse from Google's anycast.
 * - Twilio (Mozilla-style fallback): `global.stun.twilio.com:3478` --
 *   commonly recommended free public STUN endpoint.
 */
export const DEFAULT_WEBRTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

/**
 * Default collabswarm config to use if none is provided.
 *
 * Note: This is a browser-compatible default. It does not include mDNS
 *       (which requires the Node-only `dgram` module). Without bootstrap
 *       nodes this node will be in a swarm of one; use
 *       `collabswarm.connect()` or pass bootstrap addresses to join peers.
 *
 * @param bootstrapConfig Bootstrap peer list to seed peer discovery.
 * @param webrtcIceServers Optional override for the WebRTC ICE server list.
 *   When undefined, {@link DEFAULT_WEBRTC_ICE_SERVERS} is used so peers can
 *   discover their public address mappings via STUN without relying on relay
 *   infrastructure for data plane forwarding.
 */
export const defaultConfig = (
  bootstrapConfig: BootstrapInit,
  webrtcIceServers?: RTCIceServer[],
) => {
  const iceServers = webrtcIceServers ?? DEFAULT_WEBRTC_ICE_SERVERS;
  return ({
    // Helia configuration (ref: https://gist.github.com/bellbind/23ad8d6e3a1509335253ff074fcd3cb6)
    helia: {
      blockstore: new IDBBlockstore('/collabswarm-blocks'),
      datastore: new IDBDatastore('/collabswarm-data'),
      blockBrokers: [bitswap()],
      libp2p: {
        // https://github.com/ipfs/helia/blob/main/packages/helia/src/utils/libp2p-defaults.browser.ts#L27
        addresses: {
          listen: ['/webrtc', '/wss', '/ws'],
        },
        transports: [
          circuitRelayTransport({
            reservationConcurrency: 1,
          }),
          webSockets({ filter: all }),
          // Pass STUN servers so RTCPeerConnection can gather server-reflexive
          // candidates and attempt direct connections without relay forwarding.
          webRTC({ rtcConfiguration: { iceServers } }),
          webRTCDirect({ rtcConfiguration: { iceServers } }),
          webTransport(),
        ],
        streamMuxers: [yamux()],
        peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
        services: {
          identify: identify(),
          autoNAT: autoNAT(),
          pubsub: gossipsub({
            allowPublishToZeroTopicPeers: true,
            emitSelf: false,
            canRelayMessage: true,
            globalSignaturePolicy: 'StrictSign',
          }),
          dht: kadDHT({
            clientMode: true,
            validators: { ipns: ipnsValidator },
            selectors: { ipns: ipnsSelector },
          }),
        },
        // https://github.com/libp2p/js-libp2p/blob/master/doc/CONFIGURATION.md#configuring-connection-gater
        connectionGater: { denyDialMultiaddr: async () => false },
      },
    },

    pubsubDocumentPrefix: DEFAULT_DOCUMENT_TOPIC_PREFIX,
    pubsubDocumentPublishPath: '/documents',
    webrtcIceServers: iceServers,
  // Cast required: libp2p sub-dependency types have version mismatches that prevent structural compatibility
  } as unknown as CollabswarmConfig);
};

/**
 * CollabswarmConfig is a settings object for collabswarm.
 */
export interface CollabswarmConfig {
  /**
   * Configuration for Helia/libp2p.
   */
  helia?: HeliaInit;

  /**
   * Prefix to apply to document pubsub topics.
   *
   * Defaults to {@link DEFAULT_DOCUMENT_TOPIC_PREFIX} to namespace document
   * traffic on the pubsub mesh and avoid collisions with other topic types.
   *
   * Set to an empty string (`''`) to disable prefixing; topic strings
   * will be the bare document path (legacy behavior).
   *
   * @default DEFAULT_DOCUMENT_TOPIC_PREFIX
   */
  pubsubDocumentPrefix: string;

  /**
   * Prefix to apply to Libp2p PubSub topics for documents.
   */
  pubsubDocumentPublishPath: string;

  /**
   * Enable GossipSub topic validators for authorization enforcement.
   * When enabled, messages from unauthorized peers are rejected at the
   * transport layer (P4 penalty in peer scoring).
   *
   * Topic validators are registered during `open()` and properly removed
   * during `close()` to prevent stale validator references.
   *
   * Default: false (for backward compatibility).
   */
  enableTopicValidators?: boolean;

  /**
   * Enable Collabswarm application-level signing and verification.
   * When false, application-level signing is bypassed: sync message signatures,
   * load request signatures, snapshot signatures, topic validator signature
   * checks, and key update verification. Topic validators are not registered
   * at all when signing is disabled to avoid unnecessary per-message overhead.
   * Note: libp2p/GossipSub transport-level signing (e.g., `globalSignaturePolicy`)
   * is NOT affected by this flag.
   *
   * **WARNING: Disabling signing removes all authentication and authorization
   * checks. Any peer that can decrypt traffic (e.g., possesses a previous
   * document key) can forge sync, key-update, and load messages. Peers with
   * `enableSigning: false` will NOT interoperate with peers that have signing
   * enabled (they will reject empty/missing signatures). Only use in trusted
   * development/testing environments.**
   *
   * Default: true (signatures are computed and verified).
   */
  enableSigning?: boolean;

  /**
   * Configuration for history compaction.
   * When provided with `enabled: true`, the document will periodically
   * create snapshot nodes to compact the Merkle-DAG change history.
   */
  compaction?: Partial<CompactionConfig>;

  /**
   * Enable network statistics tracking.
   * When true, a `NetworkStats` counter container is created and accessible
   * via `collabswarm.networkStats`. Callers must invoke `record*()` methods
   * explicitly; automatic event wiring will be added in a follow-up.
   *
   * Default: false.
   */
  enableNetworkStats?: boolean;

  /**
   * Optional override for the WebRTC ICE server list used by the `webRTC()`
   * and `webRTCDirect()` transports. When undefined, the built-in
   * {@link DEFAULT_WEBRTC_ICE_SERVERS} list (Google + Cloudflare + Twilio
   * public STUN endpoints) is used so peers can discover their public
   * address mappings without depending on Circuit Relay for the data plane.
   *
   * Pass an empty array (`[]`) to disable STUN entirely (e.g. for
   * fully-internal LAN deployments where mDNS is sufficient), or supply
   * custom STUN/TURN servers for self-hosted infrastructure.
   *
   * Note: this field is informational once the libp2p config has already
   * been built by {@link defaultConfig}; to actually change the ICE
   * configuration, pass the override into `defaultConfig(bootstrap, ice)`
   * (or `getDefaultConfig(ice)`) so it is wired into the transports at
   * construction time.
   *
   * @default DEFAULT_WEBRTC_ICE_SERVERS
   */
  webrtcIceServers?: RTCIceServer[];

  /**
   * Optional callback to validate document paths before creation.
   *
   * Called when `open()` determines the document is new (i.e., `load()` returned
   * false -- no peers could provide the document). Note that `load()` can also
   * return false during network partitions when peers are unavailable.
   *
   * Validation runs before pubsub subscription and protocol handler registration,
   * so rejected paths never temporarily join the topic.
   *
   * - If the callback returns `false`, `open()` throws
   *   `new Error('Document path "<path>" is not allowed for the current user')`.
   * - If the callback throws, `open()` rethrows the error as-is (if it is
   *   already an `Error`) or wraps it via `new Error(String(err))`.
   *
   * May return a boolean or a Promise<boolean> for async validation.
   * Return `true` to allow creation, `false` to reject it.
   * When absent, all document paths are allowed.
   *
   * @param documentPath The path of the document being created.
   * @param userPublicKey The public key of the current user.
   */
  validateDocumentPath?: (documentPath: string, userPublicKey: unknown) => boolean | Promise<boolean>;
}

/**
 * Default bootstrap configuration to use if none is provided.
 *
 * @param clientAddresses The list of bootstrap addresses to use.
 * @returns A BootstrapInit object with the provided addresses.
 */
export const defaultBootstrapConfig = (clientAddresses: string[]) =>
  ({
    list: clientAddresses,
  } as BootstrapInit);

/**
 * Returns a fresh default config with no bootstrap peers.
 *
 * Use this as a starting point for browser applications. Connect to peers
 * after initialization via `collabswarm.connect([relayMultiaddr])`.
 *
 * For configs with bootstrap peers baked in, use
 * `defaultConfig(defaultBootstrapConfig(['/ip4/.../ws/p2p/...']))` instead.
 *
 * Each call creates new IDB-backed blockstore/datastore instances so callers
 * can safely mutate the returned config without leaking state across
 * consumers. For shared/reused configs, store the result in a variable.
 *
 * **Note:** Lazily instantiated -- safe to import in Node.js test environments
 * that lack IndexedDB as long as the function is not called.
 *
 * @param webrtcIceServers Optional override for the WebRTC ICE server list.
 *   When undefined, {@link DEFAULT_WEBRTC_ICE_SERVERS} is used.
 */
export function getDefaultConfig(
  webrtcIceServers?: RTCIceServer[],
): CollabswarmConfig {
  return defaultConfig(defaultBootstrapConfig([]), webrtcIceServers);
}
