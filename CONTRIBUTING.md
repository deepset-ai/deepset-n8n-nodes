# Contributing

Thanks for your interest in contributing! Please follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
Report security issues as described in [SECURITY.md](./SECURITY.md), not in public issues.

For bugs and feature requests, open a GitHub issue. For other questions, contact us at
[info@deepset.ai](mailto:info@deepset.ai).

## Setup

This is an npm workspaces monorepo; each package lives under `packages/`. Use a current LTS release
of Node.js, as CI does.

```bash
npm install
npm run build
npm run lint
npm run format:check
npm run test
```

Use `npm run format` to apply Prettier.

`npm install` also enables a pre-commit hook (`.githooks/pre-commit`) that checks the formatting of
the files you commit. If it fails, run `npm run format` and stage the changes. You can skip it with
`git commit --no-verify`; CI runs the same check.

## Local development

Run a node in a local n8n instance with hot reload:

```bash
cd packages/haystack-enterprise   # or packages/haystack-enterprise-mcp
npm run dev    # builds the node, loads it into n8n and starts n8n at http://localhost:5678
```

`npm run dev` watches for changes and hot-reloads the node. If another n8n instance is already
running on your machine, give the dev instance its own ports:

```bash
N8N_PORT=5679 N8N_RUNNERS_BROKER_PORT=5681 npm run dev
```

### Linting

```bash
npm run lint       # from the repo root, or inside a package
npm run lint:fix
```

`packages/haystack-enterprise` is n8n Cloud eligible, so its `lint` runs in two passes: n8n's
cloud-eligible ruleset over `nodes credentials package.json`, then the non-cloud ruleset
(`eslint.test.config.mjs`) over `test/`, which would otherwise flag the `vitest` import.
`packages/haystack-enterprise-mcp` isn't cloud eligible, so one non-cloud pass covers everything.
`npm run cloud-scan -w packages/haystack-enterprise` runs n8n's community-package scanner against a
packed build, as n8n does when a node is submitted for verification.

### Testing

```bash
npm run test            # unit tests of every package (vitest)
npm run test:contract   # contract tests against the OpenAPI spec, see below
```

### Contract tests

`packages/contract-tests` validates `@deepset-ai/n8n-nodes-haystack-enterprise`'s nodes against the
Haystack Enterprise Platform's OpenAPI spec. By default it starts a local
[Prism](https://github.com/stoplightio/prism) mock server from the published spec
(`https://docs.cloud.deepset.ai/openapi.yaml`), so no credentials are needed. To use a local spec
file: `CONTRACT_SPEC=./openapi.yaml npm run test:contract`. See
`packages/contract-tests/src/registry/` for what is covered.

## Pull requests

1. Branch from `main`. External contributors: fork the repo first. deepset maintainers: clone the
   repo directly.
2. Keep changes focused, add or update tests, and update the package's `CHANGELOG.md` for
   user-visible changes.
3. Make sure lint, format check, build and tests pass. CI runs them on every PR.

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).

## CI

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`:

- **lint-and-build**: lint, Prettier format check and build for all packages.
- **test**: unit tests of every package.
- **contract-tests**: checks the nodes against a mock of the published Haystack Enterprise Platform
  OpenAPI spec (no credentials needed).
- **cloud-scan**: runs n8n's community-package scanner against a packed build of
  `haystack-enterprise`, the same checks n8n applies when a node is submitted for verification.
- **latest-n8n**: builds and tests against the latest `n8n-workflow` and `n8n-core`.

Run the same checks locally:
`npm run lint && npm run format:check && npm run build && npm run test`.

## Releasing

Maintainers only. Each package is released and tagged independently. Pushing a release tag triggers
[`.github/workflows/publish.yml`](./.github/workflows/publish.yml), which publishes that package to
npm with a provenance statement (required by n8n for verified community nodes).

| Package                                         | Tag format                           | Notes                                        |
| ----------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| `@deepset-ai/n8n-nodes-haystack-enterprise`     | `haystack-enterprise-v<version>`     | Re-runs contract tests and n8n's scan first. |
| `@deepset-ai/n8n-nodes-haystack-enterprise-mcp` | `haystack-enterprise-mcp-v<version>` | Not n8n-verified (self-hosted only).         |

### Create a release

1. **Prepare the release in a pull request.** In `packages/<name>/`, set the new `version` in
   `package.json` and move the `CHANGELOG.md` entries from `Unreleased` to a heading with that
   version. Merge the pull request into `main` after CI passes.
2. **Check `main`.** Pull the latest `main` and confirm the merge commit contains the version bump.
   The tag must point at this commit, and the tag version must match `package.json`: the workflow
   publishes the version in `package.json`, not the one in the tag name.
3. **Create and push the tag.** From a clean checkout of `main`:

   ```bash
   git checkout main && git pull
   git tag -a haystack-enterprise-v0.1.0 -m "@deepset-ai/n8n-nodes-haystack-enterprise 0.1.0"
   git push origin haystack-enterprise-v0.1.0
   ```

   Or in the GitHub UI: **Releases → Draft a new release → Choose a tag**, type the new tag name,
   select **Create new tag on publish**, set the target to `main`, add release notes and click
   **Publish release**.

4. **Watch the workflow.** Open the **Actions** tab and follow the **Publish** run. It lints, builds
   and publishes. It fails, without publishing, if the contract tests, the n8n scan or the build
   fail.
5. **Verify.** On [npmjs.com](https://www.npmjs.com/) check that the new version is listed and shows
   the **Provenance** badge linking to the workflow run. Then install it in a test n8n instance and
   import one of the example workflows.

### If a release fails

- **Failed before publishing** (tests, scan or build): fix the problem in a pull request. Then
  delete the tag (`git push --delete origin <tag> && git tag -d <tag>`) and tag the fixed commit.
- **Already published to npm:** a version can never be published twice. Bump the version and release
  again, and deprecate the bad one with `npm deprecate <package>@<version> "<reason>"`.
