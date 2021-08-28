# Demo: Password manager

Shared secrets with item-specific access control.

## Development Status:

What you can do (eventually):

- [x] Create a new secret
- [x] Import an existing secret
- [x] Writer can share read access and changes are visible
- [x] Writer can share write access
- [ ] Reader can not write
- [ ] New writer can remove original writer
- [x] Can not read without read access
- [ ] Works in Chrome
- [ ] Works in Brave
- [ ] Does not load entire document with each (small) change
- [ ] A secret (key) can only be added once
- [ ] Read me works for new dev

## Install

Prerequisites:

- Node.js 16+
- Yarn

First, setup node modules and typescript:

```sh
yarn install
yarn workspace @collabswarm/password-manager build
```

Then, start a local web server:

```sh
yarn workspace @collabswarm/password-manager start
```

_Make sure to 'allow' network connections if asked._

Lastly, open another terminal and start the star-signal relay:

```sh
yarn workspace @collabswarm/password-manager start:relay
```

Now, you can open a browser tab to:

- <http://localhost:3000/login>

## Application quickstart

1. Open a browser tab in Chrome, click login on the login page, and copy the Peer ID (Settings > Peer ID)
2. Open a new incognito tab in Chrome. Paste the Peer ID from step one into the Bootstrap Node field, then log in.
3. In the original browser tab, copy the Public Key (Settings > Public Key).
4. In the incognito tab, create a new secret (Settings > New Secret). Enter a name and value (optional).
5. In the incognito tab, share the secret using the Key from the previous step ( Secret > Permissions > Public key to add > Add).
6. Next, copy the ID of the secret (Secret > ID)
7. In the original browser tab, add the shared secret using the ID from the previous step (Secrets > New Secret > ID > Import)

You should now have a shared secret where the Name and Value fields are updated. If write access was provided, the second peer can also edit the fields.

## Architecture

_A swarm_ has peers; peers are identified by a public key.

Each peer has a _list of secrets_; this is a swarmbase document.

Each list references _individual secrets_; each secret is a swarmbase document.

**Example:**

|                   | Swam              |                   |
| ----------------- | ----------------- | ----------------- |
| Peer A            | Peer B            | Peer C            |
| List of secrets A | List of secrets B | List of secrets C |
| Secret A          | Secret A          |                   |
|                   | Secret B          | Secret B          |

- This swarm has three peers in the same swarm
- Secret A is shared between Peer A and Peer B, but not Peer C.
