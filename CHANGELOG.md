# Changelog

## Unreleased

- The package now lives at the root of its own repository,
  [deepset-ai/n8n-nodes-haystack-enterprise](https://github.com/deepset-ai/n8n-nodes-haystack-enterprise),
  as n8n verification requires (previously `packages/haystack-enterprise` in a monorepo). The MCP
  node moved to
  [its own repository](https://github.com/deepset-ai/n8n-nodes-haystack-enterprise-mcp).
  `repository.url` in `package.json` points to the new repository, and the README points to the MCP
  node. No changes to node behavior.
- The codex files (`HaystackEnterpriseAi.node.json`, `HaystackEnterpriseChatModel.node.json`) now
  use the fully-qualified node identifier, `@deepset-ai/n8n-nodes-haystack-enterprise.<nodeName>`,
  as required by n8n verification. No changes to node behavior.

## 0.2.0

- New optional **Organization ID** field on the OAuth2 credential. Only required if you belong to
  multiple organizations; it is sent as the `X-Organization-ID` header on every request made with
  the credential, including the chat model node and streaming requests. API keys are bound to one
  organization and ignore it.

## 0.1.3

- Errors from the Haystack Enterprise API are now re-thrown as `NodeApiError` through one helper
  instead of ignoring n8n's `require-node-api-error` lint rule inline, so the package passes n8n's
  verification scan. Error messages and details are unchanged.

## 0.1.2

No changes to the nodes.

- Package author contact is now haystack@deepset.ai

## 0.1.1

Documentation only, no changes to the nodes.

- README: explain where the example workflows live and how to use them, link the Haystack Enterprise
  Platform website, getting started guide, API key instructions and the API reference for each
  operation

## 0.1.0

Initial release.

- **File** resource: Upload, Get, Get Many, Get Meta, Update Meta, Update Meta Bulk, Delete, Delete
  Many
- **Index** resource: Get, Get Many
- **Search Session** resource: Create, Get Many, Delete
- **Service** resource: Get, Get Many, List Models (Chat Completions), Chat, Chat (Streaming), Chat
  Completions
- **Haystack Enterprise Chat Model**: language-model sub-node for n8n's AI Agent, using Chat
  Completions on a Haystack Enterprise service
- **Authentication**: choose API Key or OAuth2 on the node. The OAuth2 credential registers your n8n
  instance with Haystack Enterprise automatically via Dynamic Client Registration (RFC 7591). OAuth2
  requires n8n 2.19.2 or later.
