# Changelog

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
