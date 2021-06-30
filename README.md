# CollabSwarm

[![Gitter](https://badges.gitter.im/collabswarm-dev/community.svg)](https://gitter.im/collabswarm-dev/community?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge)

![Collaborative Editing Example](docs/collaborative-editing.gif)
_Share redux stores between multiple clients (works on both browsers and servers) using eventually-consistent CRDTs!_

Implementing collaborative real-time applications can be very difficult and error prone.
CollabSwarm is a fully-baked real-time application data store built using CRDTs and
efficient distributed pub-sub algorithms.

CollabSwarm has official bindings for common webapp stores including:

- Redux (collabswarm-redux)
- More to come soon...

CollabSwarm has official bindings for the following CRDTs:

- [automerge](https://github.com/automerge/automerge)
- [Y.js](https://github.com/yjs/yjs/) (COMING SOON)

## Getting Started

Install `collabswarm-automerge`:

```sh
npm install --save @collabswarm/collabswarm-automerge @collabswarm/collabswarm-redux
```

### Collabswarm and Providers

The collabswarm API starts with the `Collabswarm` class. This class manages connections to other
collabswarm peers and helps open documents in a swarm.

Collabswarm uses various _providers_ to inject customizable behavior. Specifically collabswarm
supports customizing:

- The CRDT implementation
- The serialization algorithm for change blocks and sync messages
- The signing/encryption algorithms for authentication/access control

In the following example, collabswarm is setup to use the `automerge` CRDT, JSON serialization
for both change blocks and sync messages, and Subtle from WebCrypto to sign/encrypt:

```ts
import { Collabswarm } from "@collabswarm/collabswarm";
import {
  AutomergeJSONSerializer,
  AutomergeProvider,
} from "@collabswarm/collabswarm-automerge";

// Create the necessary providers and pass them to the collabswarm constructor.
const crdt = new AutomergeProvider();
const serializer = new AutomergeJSONSerializer();
const collabswarm = new Collabswarm(crdt, serializer, serializer);
```

### Collabswarm Config/Setup

Collabswarm also has various configuration options defined in `CollabswarmConfig`.

IPFS configuration is set through the `.ipfs` field of a `CollabswarmConfig`. This can be
modified to add swarm addresses (webrtc-star-signal servers) and bootstrap addresses
(peers to connect to on startup):

```ts
import {
  CollabswarmConfig,
  DEFAULT_CONFIG,
  addBootstrapAddr,
  addSwarmAddr,
} from "@collabswarm/collabswarm";

// Specify all options manually:

const config: CollabswarmConfig = {
  ipfs: {
    config: {
      Addresses: {
        Swarm: ["/some/peer/addr"],
      },
      Bootstrap: ["/some/star/signal/server/addr"],
    },
  },

  pubsubDocumentPrefix: "/document/",
  pubsubDocumentPublishPath: "/documents",
};

// ----- OR -----

// Specify options by modifying the default CollabswarmConfig.

let config: CollabswarmConfig = {
  ipfs: DEFAULT_CONFIG.ipfs,

  pubsubDocumentPrefix: "/document/",
  pubsubDocumentPublishPath: "/documents",
};

config = addBootstrapAddr(basicConfig, "/some/peer/addr");
config = addSwarmAddr(configWithBootstrap, "/some/star/signal/server/addr");
```

With a `CollabswarmConfig`, collabswarm can be _initialized_ (starts the underlying IPFS node
and start listening for peers):

```ts
// Set the config for your collabswarm object and startup an IPFS node.
await collabswarm.initialize(configWithSwarm);
```

Once initialized, collabswarm can then be used to connect to other peers. This step may not be
necessary if you have already connected to peers in a swarm by adding their address(es) to the
`ipfs.config.Bootstrap` field of your `CollabswarmConfig` object:

```ts
// Connect to a swarm (an address of any member of the swarm works here).
await collabswarm.connect(["/some/libp2p/peer/address"]);
```

### Collabswarm Documents

Collabswarm documents can be opened by using the `.doc(...)` method:

```ts
// Open a document.
const doc1 = collabswarm.doc("/my-doc1-path");
```

Documents can have handlers subscribed to both local and/or remote changes. This can be used to
update your application with the current version of the collabswarm's CRDT document:

```ts
// Subscribe to remote changes made to the document.
doc1.subscribe(
  "remote-handler-1",
  (current, hashes) => {
    console.log("Changes were made to /my-doc1-path. Current value:", current);
  },
  "remote"
);
```

To make a local change (change made by the current user), use the `.change(...)` method:

```ts
// Make a change to the document.
doc1.change((doc) => {
  // After the change function is completed, this updated field `field1` will be sent
  // to all peers connected to the document.
  doc.field1 = "new-value";
});
```

Documents can also be closed:

```ts
// Close the connection to the document when we're done.
// Keep in mind this will also stop serving your document.
doc1.close();
```

## Getting Started (Redux Bindings)

Install `collabswarm-automerge` and its redux bindings:

```sh
npm install --save @collabswarm/collabswarm-automerge @collabswarm/collabswarm-redux
```

Define document types (only if you're using typescript)

```ts
// models.ts
export interface ExampleDocument {
  content: automerge.Text;

  // ...
}
```

Setup the client store (ensure you also initialize the store)

```ts
// reducers.ts
import { combineReducers, CombinedState } from "redux";
import {
  automergeSwarmReducer,
  AutomergeSwarmState,
  AutomergeSwarmActions,
} from "@collabswarm/collabswarm-redux";

export type RootState = CombinedState<{
  automergeSwarm: AutomergeSwarmState<ExampleDocument>;

  // ...
}>;

export const rootReducer = combineReducers({
  // Add the collabswarm-redux reducer to provide access to a store of opened documents.
  automergeSwarm: automergeSwarmReducer,

  // ...
});

// Provides easy access to the current version of the shared document.
export function selectAutomergeSwarmState(
  rootState: RootState
): AutomergeSwarmState<ExampleDocument> {
  return rootState.automergeSwarm;
}
```

Initialize the swarm node

```ts
// App.tsx
import { AutomergeSwarmConfig } from "@collabswarm/collabswarm-automerge";
import {
  initializeAsync,
  connectAsync,
  openDocumentAsync,
  closeDocumentAsync,
  changeDocumentAsync,
} from "@collabswarm/collabswarm-redux";

// Use the actions connected below in your application's container(s) to interact with CollabSwarm.
function mapDispatchToProps(
  dispatch: ThunkDispatch<RootState, unknown, AutomergeSwarmActions>
) {
  return {
    // To automatically add nodes to the list of peers on startup, add multi-addrs to: config.ipfs.config.Bootstrap
    initializeAutomergeSwarm: (config: AutomergeSwarmConfig) =>
      dispatch(
        initializeAsync<WikiSwarmArticle, RootState>(
          config,
          (state) => state.automergeSwarm
        )
      ),
    connectToPeer: (addresses: string[]) =>
      dispatch(connectAsync(addresses, selectAutomergeSwarmState)),
    openDocument: (documentId: string) =>
      dispatch(openDocumentAsync(documentId, selectAutomergeSwarmState)),
    closeDocument: (documentId: string) =>
      dispatch(closeDocumentAsync(documentId, selectAutomergeSwarmState)),
    changeDocument: (
      documentId: string,
      changeFn: (current: any) => void,
      message?: string
    ) =>
      dispatch(
        changeDocumentAsync(
          documentId,
          changeFn,
          message,
          selectAutomergeSwarmState
        )
      ),
  };
}

// ...
```

While `collabswarm-redux` automatically updates all open documents for you in its internal store,
if necessary the following actions are dispatched and can be used in your own reducers:

```ts
// packages/collabswarm-redux/src/actions.ts

export type AutomergeSwarmActions =
  | InitializeAction
  | ConnectAction
  | OpenDocumentAction
  | CloseDocumentAction
  | SyncDocumentAction
  | ChangeDocumentAction
  | PeerConnectAction
  | PeerDisconnectAction;
```

"Login" a user

```ts
// TODO: Security/Access Control is an upcoming feature!
```

See the provided [examples](examples) for full examples.

## CRDTs

CRDTs provide a simple way to allow multiple clients to make changes simultaneously without risking a "split-brain" state
where clients do not share the same state eventually. In short, CRDTs provide collabswarm documents with the property of
eventual-consistency. Collabswarm supports a swappable CRDT implementation meaning that you have control over the merging
semantics/performance of your collabswarm documents while relying on a robust and performant networking layer.

### CRDT Performance

Performance of CRDTs can be an issue depending on the
[implementation](https://github.com/dmonad/crdt-benchmarks). Generally, performance becomes worse
as the document's history of changes grows.

In the future, some sort of compaction mechanism could be added as an optional feature. Changes
could be compacted by truncating the history after a specific number of events or something more
advanced such as compacting events into increasing time or change-count intervals.

## Distributed Web

CollabSwarm uses libp2p/IPFS to distribute CRDT change messages between nodes. By using libp2p's
[GossipSub](https://github.com/libp2p/specs/tree/master/pubsub/gossipsub), this message exchange
should scale well beyond naiive broadcast/flood based solutions which can cause
[large network spikes](https://www.youtube.com/watch?v=mlrf1058ENY&index=3&list=PLuhRWgmPaHtRPl3Itt_YdHYA0g0Eup8hQ).
These changes are also cached on individual nodes using IPFS for initial document load and error
correction (when missing changes are detected).

### Browser p2p limitations

Currently the only transport that CollabSwarm supports for browser-browser
communication is libp2p-js-web-rtc-star. This protocol requires the usage of
a centralized signaling server and/or a relay (non-browser) node if the two
browsers connecting can't communicate due to NAT translation or firewall
problems. These libp2p mechanisms fill a role similar to WebRTC's TURN and STUN
protocols/services.

## Local Development

Yarn workspaces are used to link multiple npm packages together and ensure that dependency
versions match between packages.

To build collabswarm-automerge (plus its packages):

```
yarn install
```

There is also a docker-compose.yaml file provided that runs the wiki-swarm example by default:

```sh
docker-compose build
docker-compose up
```

The browser-test can also be uncommented and run as well.

### Publishing

TODO: Improve this

```sh
# Make sure you have authenticated with npm first.
yarn npm publish
```
