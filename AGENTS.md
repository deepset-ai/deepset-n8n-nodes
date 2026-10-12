# deepset-n8n-nodes

npm workspaces monorepo of n8n community node packages for Haystack Enterprise. The root
`package.json` is private; each publishable package lives under `packages/` with its own
`package.json`, `nodes/`, `credentials/`, `test/` and `eslint.config.mjs`.

- `packages/haystack-enterprise`: main package (Haystack Enterprise node and chat model node).
- `packages/haystack-enterprise-mcp`: MCP client node, kept in its own package because it is
  self-hosted only. n8n cloud eligibility (`n8n.strict` and the eslint cloud config) applies to a
  whole package.
- `packages/contract-tests`: tests against a live Haystack Enterprise workspace
  (`npm run test:contract`).

## Conventions

- Nodes and credentials are registered in each package's `package.json` under `n8n.nodes` and
  `n8n.credentials` (paths to compiled files in `dist/`). Update them when adding, removing or
  renaming either.
- Run `npm run build`, `npm run lint`, `npm test` and `npm run format:check` before pushing. Fix
  lint and type errors rather than disabling them.
- Mark sensitive credential fields as `password`; never log secrets.
- Update the package's `CHANGELOG.md` when bumping its version.
- Packages are released independently by pushing a package-specific tag (see
  `.github/workflows/publish.yml`).

## n8n docs

- https://docs.n8n.io/integrations/creating-nodes/overview/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/
- https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/
