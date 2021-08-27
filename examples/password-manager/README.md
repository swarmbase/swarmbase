# Demo: Password manager

Shared secrets with item-specific access control.

## Prerequisites

- Node.js 16+
- Yarn

## Install

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

You now have a local instance running and should be able to log in.

## Application quickstart

Coming soon!
