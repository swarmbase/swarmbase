# Swarmbase wiki

This Vite and React example explores a collaborative wiki interface with the
Swarmbase Automerge and Redux packages.

This workspace is a source example with startup coverage, not a complete collaborative product.

## Run from source

Use Node.js 22.19.0 and Yarn 4.5.0 through Corepack. From the repository root:

```sh
corepack enable
yarn install --immutable
yarn build
yarn workspace @swarmbase/wiki-swarm start
```

Open the URL printed by Vite. The landing page provides a document ID field for
navigating to the wiki editor.

## Verify the current example

```sh
yarn exec playwright install chromium
yarn test:e2e:wiki-swarm
```

The smoke test builds this workspace and verifies that Automerge WASM loads and
the wiki interface renders in Chromium without runtime errors. It does not
assert article mutation, two-browser synchronization, concurrent editing,
restart recovery, or invitation delivery.

- [Collaborative wiki guide](https://swarmbase.github.io/swarmbase/cookbook/collaborative-wiki/)
- [Verified quick start](https://swarmbase.github.io/swarmbase/getting-started/quick-start/)
- [Current limitations](https://swarmbase.github.io/swarmbase/concepts/limitations/)
