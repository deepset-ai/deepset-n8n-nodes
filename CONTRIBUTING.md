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

1. Fork the repo and branch from `main`.
2. Keep changes focused, add or update tests, and update the package's `CHANGELOG.md` for
   user-visible changes.
3. Make sure lint, format check, build and tests pass. CI runs them on every PR.

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).

## Releasing

Maintainers only. Each package is released and tagged independently
(`haystack-enterprise-v<version>`, `haystack-enterprise-mcp-v<version>`); pushing the tag triggers
`.github/workflows/publish.yml`, which publishes to npm with provenance. See the header of that
workflow for the full steps.
