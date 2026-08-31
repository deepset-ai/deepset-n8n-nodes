# Changelog

## 0.1.0

Initial release.

- Connects to a Haystack Enterprise Platform workspace's MCP server and exposes its enabled pipelines as tools for an n8n AI Agent
- **Tools to Include** option to expose all, selected, or all-except-selected pipeline tools
- **Execute step** support for testing a single pipeline call directly
- Self-hosted n8n only (refuses to run on n8n Cloud)
- **Authentication**: choose API Key or OAuth2 on the node. The OAuth2 credential supports Dynamic Client Registration (RFC 7591) against an identity provider like Authentik 2026.8+ — no manual client ID/secret needed.
