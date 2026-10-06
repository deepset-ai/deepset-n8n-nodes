# Changelog

## 0.1.0

Initial release.

- **File** resource: Upload, Get, Get Many, Get Meta, Update Meta, Update Meta Bulk, Delete, Delete
  Many
- **Index** resource: Get, Get Many
- **Search Session** resource: Create, Get Many, Delete
- **Service** resource: Get, Get Many, List Models (Chat Completions), Search (Streaming), Chat
  (Streaming), Chat Completions
- **Haystack Enterprise Chat Model**: language-model sub-node for n8n's AI Agent, using Chat
  Completions on a Haystack Enterprise service
- **Authentication**: choose API Key or OAuth2 on the node. The OAuth2 credential registers your n8n
  instance with Haystack Enterprise automatically via Dynamic Client Registration (RFC 7591) — just
  click Connect and sign in, no client ID/secret to copy. A manually created OAuth2 client is still
  supported as a fallback (DCR requires n8n ≥ 1.119; for self-hosted Haystack Enterprise, Authentik
  2026.8+).
