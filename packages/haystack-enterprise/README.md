# @deepset-ai/n8n-nodes-haystack-enterprise

This is an n8n community node. It lets you query AI services and manage files on a
[Haystack Enterprise Platform](https://cloud.deepset.ai/) workspace from your n8n workflows.

Haystack Enterprise Platform is a platform for building production-ready AI-powered applications and
managing them across the full lifecycle — from prototyping to large-scale production. You get
everything you need to work with your data, choose your models, build and evaluate, share prototypes
with users, and run and monitor your apps in production. It is built by
[deepset](https://www.deepset.ai/), the company behind
[Haystack](https://github.com/deepset-ai/haystack), the open source AI orchestration framework.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

## Contents

- [Supported n8n versions](#supported-n8n-versions)
- [Installation](#installation)
- [Prerequisites](#prerequisites)
- [Operations](#operations)
- [Example workflows](#example-workflows)
- [Credentials](#credentials)
- [Usage](#usage)
- [Resources](#resources)
- [Version history](#version-history)
- [Contributing](#contributing)

## Supported n8n versions

This package supports n8n 2.16 and later in the 2.x series. We also check the package against the
latest n8n release.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in
the n8n community nodes documentation and enter the package name
`@deepset-ai/n8n-nodes-haystack-enterprise`.

The package is n8n Cloud eligible and also works on self-hosted n8n.

## Prerequisites

- A [Haystack Enterprise Platform](https://cloud.deepset.ai/) account with access to a workspace.
- Either an API key (**Settings → API Keys**) or a sign-in with your Haystack Enterprise account
  (OAuth2, n8n 2.19.2 or later). See [Credentials](#credentials).

## Operations

The package ships two nodes:

- **Haystack Enterprise AI** — works with these resources and operations:
  - **Service** — Get, Get Many, List Models (Chat Completions), Chat, Chat (Streaming), Chat
    Completions.
  - **File** — Upload, Get, Get Many, Delete, Delete Many, Get Metadata, Update Metadata, Update
    Metadata (Bulk).
  - **Index** — Get, Get Many.
  - **Search Session** — Create, Get Many, Delete.
- **Haystack Enterprise Chat Model** — a language-model sub-node for n8n's **AI Agent**. It runs
  Chat Completions on a Haystack Enterprise service, the same Service operation as on Haystack
  Enterprise AI. Connect it to the Agent's Model port; the Agent owns conversation history.

## Example workflows

[`test/examples/`](./test/examples) has ready-made workflows to import into your n8n instance:

- [`chat-example.json`](./test/examples/chat-example.json) — a form-triggered workflow that submits
  a question straight to **Chat** and shows the answer. The simplest example to start with.
- [`chat-with-auto-created-search-session-example.json`](./test/examples/chat-with-auto-created-search-session-example.json)
  — the simplest chat workflow: leaves **Search Session ID** empty and lets **Chat (Streaming)**
  create one automatically, remembering the returned ID for the rest of the conversation.
- [`chat-with-search-session-example.json`](./test/examples/chat-with-search-session-example.json) —
  the same conversation-history pattern, but managing the **Search Session** explicitly
  (create/list/delete) instead of relying on auto-creation.
- [`haystack-chat-model-agent-example.json`](./test/examples/haystack-chat-model-agent-example.json)
  — recommended for conversational chat: n8n **AI Agent** with **Haystack Enterprise Chat Model** on
  the Model port (deployment chat completions) and Simple Memory. Use this instead of wiring **Chat
  Completions** directly to a Chat Trigger.
- [`agent-with-chat-tools-example.json`](./test/examples/agent-with-chat-tools-example.json) — an AI
  Agent with two separate tool instances of this node, one running **Chat** for a one-off question
  and one running **Chat (Streaming)** for a conversational follow-up, so it can pick whichever fits
  the user's request.
- [`mirror-files-in-google-drive-example.json`](./test/examples/mirror-files-in-google-drive-example.json)
  — a nightly scheduled workflow that diffs a Google Drive folder against files already indexed in
  Haystack Enterprise, uploading new files, updating changed ones, deleting removed ones, and
  waiting for indexing to finish before reporting.

For programmatic use without an example, call **Service → Chat Completions** on **Haystack
Enterprise AI** and supply the OpenAI-style `messages` array yourself (fields or JSON).

To import one: in the n8n editor, open the menu (**⋮** in the top right) → **Import from File**, and
select the JSON file. You'll still need to fill in your own credentials, and any service-specific
nodes (e.g. Google Drive) with your own credentials/settings.

## Credentials

Both nodes (**Haystack Enterprise AI** and **Haystack Enterprise Chat Model**) have an
**Authentication** dropdown offering two ways to authenticate.

### API Key

1. In Haystack Enterprise Platform, go to **Settings → API Keys** and generate a key.
2. On the node, choose **API Key** and create a **Haystack Enterprise API** credential.
3. Paste the key into the credential.

Make sure the key has permission for the workspaces and resources your workflow uses.

**Using a private Haystack Enterprise deployment?** Change **Server URL** to your API origin, for
example `https://api.your-company.com`.

### OAuth2 (sign in with your Haystack Enterprise account)

OAuth2 credentials require n8n 2.19.2 or later.

1. On the node, choose **OAuth2** and create a **Haystack Enterprise OAuth2 API** credential.
2. Leave the default settings as they are.
3. Click **Connect** and sign in with your Haystack Enterprise account.

The nodes run as the signed-in user, with that user's workspace access and permissions.

> **Using a private Haystack Enterprise deployment?** Change **Server URL** to your API origin. To
> configure or reuse an existing OAuth2 client, turn **Use Dynamic Client Registration** off and
> provide its OAuth2 settings. Add the callback URL shown on the credential as a redirect URI on
> that client. Public PKCE clients do not require a client secret.

## Usage

### Chat and search sessions

**Chat** and **Chat (Streaming)** both take an optional **Search Session ID**, used to store a chat
history. Leave it empty and the node starts a session automatically, returning its ID in the
output's `search_session_id` field — feed that back into **Search Session ID** on the next call to
continue the conversation. For a one-off question, leave it empty and ignore the returned ID. To
manage sessions explicitly instead (e.g. to list or delete them later), create one with the **Search
Session** resource's **Create** operation and pass its ID in from the start.

**Chat** (`/chat`) returns one JSON result when generation finishes. **Chat (Streaming)**
(`chat-stream`) returns the answer incrementally; with **Simplify Output** on, that is one item
whose `content` is the concatenated answer.

**Chat Completions** is the OpenAI-compatible alternative: you send the full conversation as
`messages` (the client owns history — there is no search session) and get a `chat.completion` back.
Turn **Stream** on to receive OpenAI SSE chunks instead of a single JSON response. Use **List Models
(Chat Completions)** to discover valid `model` values (`{workspace}/{deployment_id}`) for Chat
Completions in that workspace.

For multi-turn chat on an **AI Agent**, use **Haystack Enterprise Chat Model**: it runs Chat
Completions on the selected service, n8n's Agent and Simple Memory build `messages` for you.

### Using Chat as an AI Agent tool

This node sets `usableAsTool: true`, so any operation can be connected to an AI Agent's Tool input
instead of the main flow — the agent decides whether and when to call it, and with what arguments,
based on the conversation.

To make a Haystack Enterprise **service** the Agent's language model (not just a tool), connect
**Haystack Enterprise Chat Model** to the Agent's Model input. See
[`haystack-chat-model-agent-example.json`](./test/examples/haystack-chat-model-agent-example.json).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Haystack Enterprise Platform docs](https://docs.cloud.deepset.ai/)

## Version history

See the [changelog](./CHANGELOG.md).

## Contributing

Developing or testing changes locally? See
[CONTRIBUTING.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/CONTRIBUTING.md). Report
security issues as described in
[SECURITY.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/SECURITY.md).
