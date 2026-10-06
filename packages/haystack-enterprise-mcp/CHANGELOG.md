# Changelog

## 0.1.0

Initial release.

- Connects to a Haystack Enterprise Platform workspace's MCP server and exposes its enabled
  pipelines as tools for an n8n AI Agent
- **Tools to Include** option to expose all, selected, or all-except-selected pipeline tools
- **Execute step** support for testing a single pipeline call directly
- Self-hosted n8n only (refuses to run on n8n Cloud)
- **Authentication**: choose API Key or OAuth2 on the node. The OAuth2 credential registers your n8n
  instance with Haystack Enterprise automatically via Dynamic Client Registration (RFC 7591) — just
  click Connect and sign in, no client ID/secret to copy. Expired access tokens are refreshed and
  the MCP request retried transparently. A manually created OAuth2 client is still supported as a
  fallback (DCR requires n8n ≥ 1.119; for self-hosted Haystack Enterprise, Authentik 2026.8+).
