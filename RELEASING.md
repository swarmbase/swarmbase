# Releasing

The `@swarmbase/*` packages are published to npm by the
[Release workflow](.github/workflows/release.yml).

## Cutting a release

1. Bump the `version` field of every publishable workspace
   (`packages/*/package.json`) to the same new version. The workflow refuses
   to publish if any version disagrees with the tag.
2. Land the bump on `main`, then tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Prerelease tags (e.g. `v0.2.0-alpha.1`) publish under the `next` dist-tag;
   everything else publishes under `latest`.

3. Watch the Release run. It installs, builds, runs the unit test suite,
   verifies versions, packs each workspace with `yarn pack` (which rewrites
   `workspace:` dependency ranges to real versions), and publishes the
   tarballs with npm provenance attestations.

To test the pipeline without publishing, run the workflow manually from the
Actions tab — the default `dry-run: true` does everything except upload.

## One-time setup

1. **Claim the scope.** Create the `swarmbase` organization on
   [npmjs.com](https://www.npmjs.com/org/create) (this reserves `@swarmbase/*`).
2. **Create a token.** In npm: Access Tokens → Generate New Token →
   **Granular Access Token** with *Read and write* permission scoped to the
   `@swarmbase` organization's packages, and allow it to bypass 2FA for
   publishing. Set an expiry and calendar a rotation.
3. **Add the secret.** In the GitHub repo: Settings → Secrets and variables →
   Actions → New repository secret named `NPM_TOKEN`.
4. **(Recommended) Protect the environment.** The job runs in the
   `npm-publish` environment (created automatically on first run). Under
   Settings → Environments → `npm-publish` you can require reviewers so
   publishes need a human approval, and restrict it to `v*` tags.
5. **Dry-run.** Actions → Release → Run workflow (leave `dry-run` checked).
   Everything should go green without touching the registry.

## Switching to tokenless trusted publishing (after the first release)

Once the packages exist on npm, you can drop the token entirely:

1. On each package's npm page: Settings → Trusted publisher →
   GitHub Actions, with repository `swarmbase/swarmbase`, workflow
   `release.yml`, environment `npm-publish`.
2. Delete the `NPM_TOKEN` secret. The npm CLI exchanges GitHub's OIDC token
   automatically (that is what the `id-token: write` permission and the
   npm-CLI update step in the workflow are for), and provenance is generated
   by default.
