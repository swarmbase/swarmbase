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
import { dcutr } from '@libp2p/dcutr';
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
 * **Privacy note:** Using these defaults discloses each peer's public
 * IP/port mapping (and approximate location/ISP) to the listed third-party
 * STUN operators. Privacy-sensitive deployments should pass `[]` to disable
 * STUN entirely, or supply their own self-hosted STUN/TURN endpoints via
 * the `webrtcIceServers` parameter.
 *
 * Sources:
 * - Google: `stun.l.google.com:19302` -- the de-facto reference public STUN
 *   server, widely used in WebRTC examples and production apps.
 * - Cloudflare: `stun.cloudflare.com:3478` -- operated by Cloudflare's
 *   public WebRTC infra; geographically diverse from Google's anycast.
 * - Twilio (Mozilla-style fallback): `global.stun.twilio.com:3478` --
 *   commonly recommended free public STUN endpoint.
 */
/**
 * Project-local ICE-server interface used in place of the DOM lib's
 * `RTCIceServer` so consumers don't need `lib: ["DOM"]` in their tsconfig
 * (especially Node-only consumers of `collabswarm-node.ts`). The shape
 * mirrors the subset of WebIDL `RTCIceServer` collabswarm actually reads
 * and forwards into libp2p's webRTC transport configuration.
 *
 * Structurally compatible with `RTCIceServer` in browser environments, so
 * values typed as `IceServer` can be cast to `RTCIceServer[]` at the
 * libp2p call site without runtime conversion.
 */
export interface IceServer {
  /** A single STUN/TURN URL or a list of URLs for this server entry. */
  urls: string | string[];
  /** Username for TURN authentication. Optional. */
  username?: string;
  /** Credential (typically a shared secret / password) for TURN
   *  authentication. Optional. */
  credential?: string;
}

export const DEFAULT_WEBRTC_ICE_SERVERS: ReadonlyArray<Readonly<IceServer>> =
  Object.freeze([
    Object.freeze({ urls: 'stun:stun.l.google.com:19302' }),
    Object.freeze({ urls: 'stun:stun1.l.google.com:19302' }),
    Object.freeze({ urls: 'stun:stun.cloudflare.com:3478' }),
    Object.freeze({ urls: 'stun:global.stun.twilio.com:3478' }),
  ]);

/**
 * Returns a deep-enough copy of an {@link IceServer} so callers can hand the
 * result to libp2p (which expects a mutable `RTCIceServer`) without sharing
 * any inner references with the source object.
 *
 * In particular:
 * - the top-level object is a fresh `{ ...server }` so mutating fields like
 *   `username`/`credential` on the copy cannot affect the source;
 * - if `urls` is an array, it is copied to a fresh array so `push()`/`splice()`
 *   on the copy cannot affect the source's URL list (a single `string` value
 *   is immutable, so it is forwarded as-is).
 *
 * `credential` is a `string` in the project-local {@link IceServer} shape
 * (and strings are immutable), so no nested copy is needed there.
 *
 * Exported so {@link defaultNodeConfig} (and any future config helpers) can
 * share the same defensive-copy behavior.
 */
export const cloneIceServer = (server: IceServer): IceServer => {
  const clone: IceServer = { ...server };
  if (Array.isArray(server.urls)) {
    clone.urls = [...server.urls];
  }
  return clone;
};

/**
 * Freezes an {@link IceServer} and any nested mutable structures it owns so
 * the returned value is safe to expose to consumers as deeply-immutable.
 *
 * `Object.freeze` is shallow, so without also freezing the nested `urls`
 * array (when present) a caller could still mutate it through the exposed
 * reference. This helper closes that gap. `urls` as a plain `string` and
 * the `string` `credential`/`username` fields are already immutable and
 * need no extra handling.
 *
 * Mutates the input in place (then returns it) -- callers should pair it
 * with {@link cloneIceServer} when they need to freeze a copy without
 * affecting the source.
 *
 * Exported so {@link defaultNodeConfig} (and any future config helpers) can
 * share the same deep-freeze behavior.
 */
export const freezeIceServer = (server: IceServer): Readonly<IceServer> => {
  if (Array.isArray(server.urls)) {
    Object.freeze(server.urls);
  }
  return Object.freeze(server);
};

/**
 * Internal helper: resolve the source ICE-server list (override or frozen
 * defaults) and produce a deeply-frozen, defensively-cloned `exposed` view
 * suitable for assigning to `config.webrtcIceServers`.
 *
 * Returning both halves lets the caller hand out fresh per-transport copies
 * of `sourceIceServers` (via `cloneIceServer`) without re-deriving the
 * source, while sharing the deep-freeze/clone setup between the browser
 * (`defaultConfig`) and Node (`defaultNodeConfig`) defaults so they cannot
 * drift over time.
 *
 * Not exported from the package barrel: this is an implementation detail of
 * the default config builders.
 */
export function resolveIceServers(override?: ReadonlyArray<Readonly<IceServer>>): {
  sourceIceServers: ReadonlyArray<Readonly<IceServer>>;
  exposedIceServers: ReadonlyArray<Readonly<IceServer>>;
} {
  const sourceIceServers = override ?? DEFAULT_WEBRTC_ICE_SERVERS;
  const exposedIceServers: ReadonlyArray<Readonly<IceServer>> = Object.freeze(
    sourceIceServers.map((server) => freezeIceServer(cloneIceServer(server))),
  );
  return { sourceIceServers, exposedIceServers };
}

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
  webrtcIceServers?: ReadonlyArray<Readonly<IceServer>>,
) => {
  // Resolve the source list and a deeply-frozen exposed view in one place so
  // the browser and Node defaults stay in sync. Each transport below still
  // gets its own fresh `cloneIceServer`-deep-cloned copy of `sourceIceServers`
  // so mutations never leak between transport state and `config.webrtcIceServers`.
  const { sourceIceServers, exposedIceServers } = resolveIceServers(webrtcIceServers);
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
          // Each transport gets its own fresh mutable copy (with each server
          // object also deep-enough-cloned via `cloneIceServer`) to avoid
          // aliasing with the array exposed on `config.webrtcIceServers` below.
          // Cast to `RTCIceServer[]` only at the libp2p call site so the
          // public collabswarm API stays free of DOM lib types.
          webRTC({ rtcConfiguration: { iceServers: sourceIceServers.map(cloneIceServer) as RTCIceServer[] } }),
          webRTCDirect({ rtcConfiguration: { iceServers: sourceIceServers.map(cloneIceServer) as RTCIceServer[] } }),
          webTransport(),
        ],
        streamMuxers: [yamux()],
        peerDiscovery: [bootstrap(bootstrapConfig), pubsubPeerDiscovery()],
        services: {
          identify: identify(),
          dcutr: dcutr(),
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
    webrtcIceServers: exposedIceServers,
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
   * **Privacy note:** Using the public STUN defaults discloses each peer's
   * public IP/port mapping to the third-party STUN operators. For
   * privacy-sensitive deployments, pass `[]` to disable STUN entirely (e.g.
   * for fully-internal LAN deployments where mDNS is sufficient), or supply
   * self-hosted STUN/TURN servers.
   *
   * Note: this field is informational once the libp2p config has already
   * been built by {@link defaultConfig}; to actually change the ICE
   * configuration, pass the override into `defaultConfig(bootstrap, ice)`
   * (or `getDefaultConfig(ice)`) so it is wired into the transports at
   * construction time.
   *
   * @default DEFAULT_WEBRTC_ICE_SERVERS
   */
  webrtcIceServers?: ReadonlyArray<Readonly<IceServer>>;

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
  webrtcIceServers?: ReadonlyArray<Readonly<IceServer>>,
): CollabswarmConfig {
  return defaultConfig(defaultBootstrapConfig([]), webrtcIceServers);
}
