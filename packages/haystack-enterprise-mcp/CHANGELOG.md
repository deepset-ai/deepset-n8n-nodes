# Changelog

## 0.2.0

- New optional **Organization ID** field on the OAuth2 credential. Only required if you belong to
  multiple organizations; it is sent as the `X-Organization-ID` header on every request made with
  the credential, including the MCP connection and the workspace list. API keys are bound to one
  organization and ignore it.
- Fixed the example workflow: its OpenAI Chat Model node now uses a current node version, so the AI
  Agent no longer fails with "model.includes is not a function".

## 0.1.1

- Documentation: simplified the README (supported n8n versions folded into Installation, clearer
  tool selection, direct link to the example workflow, Usage merged into Operations)

## 0.1.0

Initial release.

- Connects to a Haystack Enterprise Platform workspace's MCP server and exposes its enabled
  pipelines as tools for an n8n AI Agent
- **Tools to Include** option to expose all, selected, or all-except-selected pipeline tools
- **Execute step** support for testing a single pipeline call directly
- Self-hosted n8n only (refuses to run on n8n Cloud)
- **Authentication**: choose API Key or OAuth2 on the node. The OAuth2 credential registers your n8n
  instance with Haystack Enterprise automatically via Dynamic Client Registration (RFC 7591). OAuth2
  requires n8n 2.19.2 or later.
