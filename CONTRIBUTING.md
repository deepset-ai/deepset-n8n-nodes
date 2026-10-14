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

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`. Runs for the same
branch or PR cancel each other when superseded. Jobs:

- **lint-and-build**: `npm run lint`, `npm run format:check` (Prettier) and `npm run build` across
  all packages.
- **test**: the unit tests of every package (`npm run test`).
- **contract-tests**: validates the nodes' request-building code against a local Prism mock of the
  published Haystack Enterprise Platform OpenAPI spec. No credentials needed.
- **latest-n8n**: upgrades `n8n-workflow` and `n8n-core` to the latest versions, then builds and
  tests, to catch breakage with newer n8n releases. The lockfile pins the supported floor.

Dependabot opens monthly dependency update PRs (`.github/dependabot.yml`). Run the same checks
locally before pushing: `npm run lint && npm run format:check && npm run build && npm run test`.

## Releasing

Maintainers only. Each package is released and tagged independently
(`haystack-enterprise-v<version>`, `haystack-enterprise-mcp-v<version>`); pushing the tag triggers
`.github/workflows/publish.yml`, which (for `haystack-enterprise`, after re-running the contract
tests) publishes to npm with provenance. See the header of that workflow for the full steps.
