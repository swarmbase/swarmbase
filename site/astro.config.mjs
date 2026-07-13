// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Served as a GitHub Pages project page until a custom domain is set up.
export default defineConfig({
  site: 'https://swarmbase.github.io',
  base: '/swarmbase',
  vite: {
    resolve: {
      alias: [
        {
          // The core barrel drags in libp2p/Helia, which the browser bundle
          // doesn't need. The sync demo only uses light modules, re-exported
          // by the shim.
          find: /^@swarmbase\/collabswarm$/,
          replacement: fileURLToPath(
            new URL('./src/lib/collabswarm-shim.ts', import.meta.url),
          ),
        },
      ],
    },
  },
  integrations: [
    starlight({
      title: 'Swarmbase',
      description:
        'An encrypted, serverless, local-first document database that syncs browser to browser.',
      logo: {
        src: './src/assets/logo.svg',
        alt: 'Swarmbase',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/swarmbase/swarmbase',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/swarmbase/swarmbase/edit/main/site/',
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting started',
          items: ['getting-started/quick-start'],
        },
        {
          label: 'Concepts',
          items: [
            'concepts/local-first',
            'concepts/crdts',
            'concepts/networking',
            'concepts/storage',
            'concepts/security',
            'concepts/limitations',
          ],
        },
        {
          label: 'Cookbook',
          items: [
            'cookbook/collaborative-wiki',
            'cookbook/password-manager',
            'cookbook/react',
            'cookbook/redux',
            'cookbook/search-indexing',
            'cookbook/yjs-schema-design',
            'cookbook/running-a-relay',
            'cookbook/pinning',
          ],
        },
        {
          label: 'Reference',
          items: [{ autogenerate: { directory: 'reference' } }],
        },
        {
          label: 'Community',
          items: [
            'community',
            'community/contributing',
            'community/help-wanted',
          ],
        },
      ],
    }),
  ],
});
