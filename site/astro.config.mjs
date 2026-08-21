// @ts-check
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

const removeGeneratedApiLanding = {
  name: 'remove-generated-api-landing',
  hooks: {
    'astro:config:setup': () => {
      rmSync(
        fileURLToPath(
          new URL(
            './src/content/docs/reference/api/README.md',
            import.meta.url,
          ),
        ),
        { force: true },
      );
    },
  },
};

// Served as a GitHub Pages project page until a custom domain is set up.
export default defineConfig({
  site: 'https://swarmbase.github.io',
  base: '/swarmbase',
  vite: {
    resolve: {
      alias: [
        {
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
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            '../packages/collabswarm',
            '../packages/collabswarm-yjs',
            '../packages/collabswarm-automerge',
            '../packages/collabswarm-react',
            '../packages/collabswarm-redux',
            '../packages/collabswarm-index',
          ],
          output: 'reference/api',
          sidebar: { label: 'Packages', collapsed: true },
          typeDoc: {
            entryPointStrategy: 'packages',
            excludePrivate: true,
            excludeProtected: true,
            excludeInternal: true,
            treatWarningsAsErrors: true,
          },
        }),
      ],
      title: 'Swarmbase',
      description:
        'Encrypted, local-first CRDT documents synchronized over peer-to-peer networks.',
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
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: '/swarmbase/og-image.svg' },
        },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: ['getting-started/quick-start'],
        },
        {
          label: 'Concepts',
          items: [
            'concepts/why-swarmbase',
            'concepts/architecture',
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
          items: [
            'reference',
            'reference/comparisons',
            typeDocSidebarGroup,
          ],
        },
        {
          label: 'Community',
          items: [
            'community',
            'community/faq',
            'community/roadmap',
            'community/contributing',
            'community/help-wanted',
          ],
        },
      ],
    }),
    removeGeneratedApiLanding,
  ],
});
