# Haystack Enterprise Platform n8n community nodes

This repo contains deepset's [n8n](https://n8n.io/) community node packages for integrating n8n workflows with [Haystack Enterprise Platform](https://www.deepset.ai).

## Packages

| Package | What it does | Docs |
| --- | --- | --- |
| `n8n-nodes-haystack-enterprise` | Query AI services (search, chat) and manage files/indexes/search sessions on a Haystack Enterprise Platform workspace. n8n Cloud eligible. | [README](./packages/haystack-enterprise/README.md) |
| `n8n-nodes-haystack-enterprise-mcp` | Expose pipelines you've enabled as MCP tools on a Haystack Enterprise Platform workspace as tools for an n8n AI Agent. Self-hosted n8n only. | [README](./packages/haystack-enterprise-mcp/README.md) |

Each package lives in its own directory under `packages/`, with its own `package.json`, `nodes/`, `credentials/`, `test/`, and `README.md`. See each package's README for what it does, its operations/credentials, and how to install and use it.

## Status: released

Both packages are published to npm and available as n8n community nodes — see each package's README for installation instructions. If you want to run a node from a local checkout instead of an installed release (e.g. to test changes before cutting one), see the **"Local development"** section in each package's README for how to install n8n locally and load the node into it, along with ready-made example workflows under each package's `test/examples/`.

## Development

This repo uses n8n's [`n8n-node` CLI](https://docs.n8n.io/integrations/creating-nodes/build/reference/) per package for building, dev mode, and linting. From the repo root, these scripts run across every package in the workspace:

```bash
npm install     # install deps for every package
npm run build   # build every package
npm run lint     # lint every package
npm run test     # run every package's test suite
```

See each package's README for package-specific details, and [`.agents/workflow.md`](./.agents/workflow.md) for the fuller development workflow (including known issues and local Docker-based testing notes).

### Contract tests

`packages/contract-tests` validates `n8n-nodes-haystack-enterprise`'s nodes against the Haystack Enterprise Platform's OpenAPI spec — mocked by default, so no real credentials or environment are needed:

```bash
npm run test:contract   # from the repo root, or inside packages/contract-tests
```

By default this starts a local [Prism](https://github.com/stoplightio/prism) mock server from the publicly published spec (`https://docs.cloud.deepset.ai/openapi.yaml`) and runs the nodes' real request-building code against it, catching drift between the nodes and the real API contract. Two environment variables let you point it elsewhere instead:

```bash
# Validate against a local spec file instead of the published one
CONTRACT_SPEC=./openapi.yaml npm run test:contract

# Skip the mock server and hit a real environment directly (e.g. an ephemeral env), using a local spec that matches it
CONTRACT_TARGET=https://your-ephemeral-env.example.com/api/v1 CONTRACT_SPEC=./openapi.yaml npm run test:contract
```

See `packages/contract-tests/src/registry/` for what's covered per resource.

## Releasing

Each package is released and published to npm independently, gated by its own package-specific git tag:

- `haystack-enterprise-v<version>` — publishes `n8n-nodes-haystack-enterprise`
- `haystack-enterprise-mcp-v<version>` — publishes `n8n-nodes-haystack-enterprise-mcp`

Pushing a matching tag triggers [`.github/workflows/publish.yml`](./.github/workflows/publish.yml), which lints, builds, and publishes that package to npm with a [provenance](https://docs.npmjs.com/generating-provenance-statements) attestation (required by n8n for all community nodes starting May 1 2026).

To cut a release for a package:

```bash
npm run lint -w packages/<name> && npm run build -w packages/<name>
# for haystack-enterprise specifically, also run: npm run test:contract

# bump "version" in packages/<name>/package.json and add an entry to its CHANGELOG.md
git add packages/<name>/package.json packages/<name>/CHANGELOG.md
git commit -m "release: <name> v<version>"
git tag <name>-v<version>
git push && git push origin <name>-v<version>
```

`<name>` is the package's directory name under `packages/` (`haystack-enterprise` or `haystack-enterprise-mcp`), which also doubles as the tag prefix.

Before a package's very first release, it needs one-time npm publishing setup (OIDC trusted publishing, or an `NPM_TOKEN` repository secret) — see the comments at the top of `publish.yml` for the exact steps.

## License

MIT — see [LICENSE](./LICENSE). Each package also ships its own copy under `packages/<name>/LICENSE`.
