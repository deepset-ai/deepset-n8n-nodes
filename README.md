# Haystack Enterprise Platform n8n community nodes

This repo contains deepset's [n8n](https://n8n.io/) community node packages for integrating n8n
workflows with [Haystack Enterprise Platform](https://www.deepset.ai).

## Packages

| Package                             | What it does                                                                                                                                                        | Docs                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `n8n-nodes-haystack-enterprise`     | Query AI services (search, chat) and manage files/indexes/search sessions on a Haystack Enterprise Platform workspace. n8n Cloud eligible. Ready for first release. | [README](./packages/haystack-enterprise/README.md)     |
| `n8n-nodes-haystack-enterprise-mcp` | Expose pipelines you've enabled as MCP tools on a Haystack Enterprise Platform workspace as tools for an n8n AI Agent. Self-hosted n8n only. Not yet published.     | [README](./packages/haystack-enterprise-mcp/README.md) |

Each package lives in its own directory under `packages/`, with its own `package.json`, `nodes/`,
`credentials/`, `test/`, and `README.md`. See each package's README for what it does, its
operations/credentials, and how to install and use it.

## Status

`n8n-nodes-haystack-enterprise` is ready for its first release and n8n verification; it isn't
published to npm yet. `n8n-nodes-haystack-enterprise-mcp` is not part of that release: it is
self-hosted only and is not submitted for verification.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local development, linting, tests, contract tests and
the release process, [SECURITY.md](./SECURITY.md) to report vulnerabilities, and the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE). Each package also ships its own copy under
`packages/<name>/LICENSE`.
