# Changelog

## Unreleased

- **Credentials:** configurable **Server URL** on Haystack Enterprise API credentials (default hosted
  Haystack Enterprise Platform API). Workspace listing and MCP connections use the configured origin.

## 0.1.0

Initial release.

- Connects to a Haystack Enterprise Platform workspace's MCP server and exposes its enabled
  pipelines as tools for an n8n AI Agent
- **Tools to Include** option to expose all, selected, or all-except-selected pipeline tools
- **Execute step** support for testing a single pipeline call directly
- Self-hosted n8n only (refuses to run on n8n Cloud)
