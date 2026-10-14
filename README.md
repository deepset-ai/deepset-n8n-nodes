# Haystack Enterprise Platform n8n community nodes

This repo contains deepset's [n8n](https://n8n.io/) community node packages for integrating n8n
workflows with [Haystack Enterprise Platform](https://cloud.deepset.ai/).

[deepset](https://www.deepset.ai/) develops [Haystack](https://github.com/deepset-ai/haystack), the
open source AI orchestration framework, and the Haystack Enterprise Platform, its managed platform
for building, deploying and running Haystack-based AI applications.

## Packages

| Package                             | What it does                                                                                                                                                                           | Docs                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `n8n-nodes-haystack-enterprise`     | Chat with deployed AI services, use them as a chat model for AI Agents, and manage files, indexes and search sessions in a Haystack Enterprise Platform workspace. n8n Cloud eligible. | [README](./packages/haystack-enterprise/README.md)     |
| `n8n-nodes-haystack-enterprise-mcp` | Expose pipelines you've enabled as MCP tools on a Haystack Enterprise Platform workspace as tools for an n8n AI Agent. Self-hosted n8n only. Not yet published.                        | [README](./packages/haystack-enterprise-mcp/README.md) |

Each package lives in its own directory under `packages/`, with its own `package.json`, `nodes/`,
`credentials/`, `test/`, and `README.md`. See each package's README for what it does, its
operations/credentials, and how to install and use it.

## Status

`n8n-nodes-haystack-enterprise` is released (0.1.0) and available on npm as an n8n community node.
`n8n-nodes-haystack-enterprise-mcp` is not yet published. It is self-hosted only and is not
submitted for verification.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development, linting, tests, contract tests and
the release process, [SECURITY.md](./SECURITY.md) to report vulnerabilities, and the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE). Each package also ships its own copy under
`packages/<name>/LICENSE`.
