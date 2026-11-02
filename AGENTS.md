# n8n-nodes-haystack-enterprise

n8n community node package (`@deepset-ai/n8n-nodes-haystack-enterprise`) with the Haystack
Enterprise nodes (Haystack Enterprise AI and the chat model node). The package lives at the repo
root, as n8n verification requires; there is no monorepo and no npm workspace. It is n8n Cloud
eligible (`n8n.strict` and the eslint cloud config).

The MCP client node lives in its own repository,
https://github.com/deepset-ai/n8n-nodes-haystack-enterprise-mcp (self-hosted only, not verified).

- `nodes/`, `credentials/`: the node and credential sources.
- `test/`: unit tests (vitest).
- `contract-tests/`: tests of the nodes' requests against the Haystack Enterprise OpenAPI spec
  (`npm run test:contract`), run against a local Prism mock. Not part of the published package.

## Conventions

- Nodes and credentials are registered in `package.json` under `n8n.nodes` and `n8n.credentials`
  (paths to compiled files in `dist/`). Update them when adding, removing or renaming either.
- Run `npm run build`, `npm run lint`, `npm test` and `npm run format:check` before pushing. Fix
  lint and type errors rather than disabling them.
- Don't add npm lifecycle scripts (`prepare`, `postinstall`, ...) to `package.json`: n8n forbids
  them in community node packages.
- Mark sensitive credential fields as `password`; never log secrets.
- Update `CHANGELOG.md` when bumping the version.
- Releases are published by pushing a `v<version>` tag (see `.github/workflows/publish.yml`).

## n8n docs

- https://docs.n8n.io/integrations/creating-nodes/overview/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/
