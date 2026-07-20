# Haystack Enterprise Platform n8n community nodes

This repo contains deepset's [n8n](https://n8n.io/) community node packages for integrating n8n workflows with [Haystack Enterprise Platform](https://www.deepset.ai).

## Packages

| Package | What it does | Docs |
| --- | --- | --- |
| `n8n-nodes-haystack-enterprise` | Query AI services (search, chat) and manage files/indexes/search sessions on a Haystack Enterprise Platform workspace. n8n Cloud eligible. | [README](./packages/haystack-enterprise/README.md) |
| `n8n-nodes-haystack-enterprise-mcp` | Expose pipelines you've enabled as MCP tools on a Haystack Enterprise Platform workspace as tools for an n8n AI Agent. Self-hosted n8n only. | [README](./packages/haystack-enterprise-mcp/README.md) |

Each package lives in its own directory under `packages/`, with its own `package.json`, `nodes/`, `credentials/`, `test/`, and `README.md`. See each package's README for what it does, its operations/credentials, and how to install and use it.

## Status: pre-release

Neither package is published to npm yet. If you're a colleague testing these nodes locally ahead of an official release, see the **"Local testing (pre-release)"** section in each package's README for how to install n8n locally and load the node into it, along with ready-made example workflows under each package's `test/examples/`.

## Development

This repo uses n8n's [`n8n-node` CLI](https://docs.n8n.io/integrations/creating-nodes/build/reference/) per package for building, dev mode, and linting. From the repo root, these scripts run across every package in the workspace:

```bash
npm install     # install deps for every package
npm run build   # build every package
npm run lint     # lint every package
npm run test     # run every package's test suite
```

See each package's README for package-specific details, and [`.agents/workflow.md`](./.agents/workflow.md) for the fuller development workflow (including known issues and local Docker-based testing notes).

## License

MIT — see [LICENSE](./LICENSE). Each package also ships its own copy under `packages/<name>/LICENSE`.
