# swarmDB password manager

## Shared secrets with item-specific access control.

This is a demo application implementing swarmDB. Think of 1 password without a central server, where secrets can be shared among one person's devices, and with other people. Where secrets, and read/write permissions to each secret, can be dynamically modified.

# Install

```sh
yarn install
yarn workspace @collabswarm/collabswarm tsc
yarn workspace @collabswarm/collabswarm-yjs tsc
yarn workspace @collabswarm/collabswarm-react tsc
```

# Usage

`yarn workspace @collabswarm/password-manager start`
