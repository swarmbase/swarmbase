# `json-change-api`

An API that provides the ability to interface with automerge/y.js/json-diff-patch/???

Basically:

* Make changes to a JSON object.
* Send those changes over the network.
* Apply changes from unknown sources. (should also be idempotent)

Could also make the network layer swappable

* libp2p (gossipsub + webrtc-star + relay nodejs nodes)
* peerjs (total direct connect + webrtc signaling server(s) + pubsub server over websockets?)
* fully centralized postgres + graphql (apollo)/supabase/tsoa?

Might need an abstraction around the control-plane layer? Ideally there would be no control plane in the future.
