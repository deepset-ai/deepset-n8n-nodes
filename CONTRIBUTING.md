# Contributing

Thanks for your interest in contributing! Please follow our [Code of Conduct](./CODE_OF_CONDUCT.md).
Report security issues as described in [SECURITY.md](./SECURITY.md), not in public issues.

## Setup

This is an npm workspaces monorepo; each package lives under `packages/`.

```bash
npm install
npm run build
npm run lint
npm run format:check
npm run test
```

Use `npm run format` to apply Prettier. See the [README](./README.md) and each package's README for
details, including the contract tests (`npm run test:contract`).

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
- **latest-n8n**: builds and tests against the latest `n8n-workflow` and `n8n-core`.

Run the same checks locally:
`npm run lint && npm run format:check && npm run build && npm run test`.

## Releasing

Maintainers only. Each package is released and tagged independently
(`haystack-enterprise-v<version>`, `haystack-enterprise-mcp-v<version>`); pushing the tag triggers
`.github/workflows/publish.yml`, which (for `haystack-enterprise`, after re-running the contract
tests) publishes to npm with provenance. See the header of that workflow for the full steps.
