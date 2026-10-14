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

Use `npm run format` to apply Prettier.

## Local development

Run a node in a local n8n instance with hot reload (use a self-hosted instance for the MCP package,
which refuses to run on n8n Cloud):

```bash
cd packages/haystack-enterprise   # or packages/haystack-enterprise-mcp
npm run dev    # builds the node, loads it into n8n and starts n8n at http://localhost:5678
```

If `npm run dev` fails with `Error: Command "start" not found` (an upstream dependency conflict in
n8n's bundled AI nodes), run it in external mode and start your own n8n instance (for example
`npm install -g n8n`) against the same custom nodes folder:

```bash
npm run dev -- --external-n8n

# in another terminal:
N8N_DEV_RELOAD=true N8N_USER_FOLDER=~/.n8n-node-cli n8n start
```

The example workflows under each package's `test/examples/` use the node types of the published npm
packages (for example `n8n-nodes-haystack-enterprise.haystackEnterpriseAi`). A node loaded with
`npm run dev` is called `CUSTOM.<nodeName>` instead, so to import an example into a local dev
instance, replace the package-name prefix in the JSON first, for example:

```bash
sed 's/n8n-nodes-haystack-enterprise\./CUSTOM./g' test/examples/chat-example.json > /tmp/chat-example.json
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

`packages/contract-tests` validates `n8n-nodes-haystack-enterprise`'s nodes against the Haystack
Enterprise Platform's OpenAPI spec. By default it starts a local
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
- **latest-n8n**: builds and tests against the latest `n8n-workflow` and `n8n-core`.

Run the same checks locally:
`npm run lint && npm run format:check && npm run build && npm run test`.

## Releasing

Maintainers only. Each package is released and tagged independently
(`haystack-enterprise-v<version>`, `haystack-enterprise-mcp-v<version>`); pushing the tag triggers
`.github/workflows/publish.yml`, which (for `haystack-enterprise`, after re-running the contract
tests) publishes to npm with provenance. See the header of that workflow for the full steps.
