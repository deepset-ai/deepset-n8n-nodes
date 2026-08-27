# n8n-nodes-haystack-enterprise

This is an n8n community node. It lets you query AI services and manage files on a [Haystack Enterprise Platform](https://www.deepset.ai) workspace from your n8n workflows.

Haystack Enterprise Platform is a platform for building production-ready AI-powered applications and managing them across the full lifecycle — from prototyping to large-scale production. You get everything you need to work with your data, choose your models, build and evaluate, share prototypes with users, and run and monitor your apps in production.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Local testing (pre-release)](#local-testing-pre-release)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Linting](#linting)
[Testing](#testing)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

> This package isn't published to npm yet. Until it is, use [Local testing (pre-release)](#local-testing-pre-release) below instead.

## Local testing (pre-release)

This section is for internal/colleague testing before the package is published to npm. Once it's published, use the [Installation](#installation) instructions above instead.

### Prerequisites

- Node.js and npm
- A running n8n instance to load the node into (a local Docker container, a global `n8n` install, or the one `n8n-node dev` can start for you)

### Installing and running n8n itself

You don't need to do this to try `npm run dev` below — by default it starts and manages its own n8n instance for you. Set up your own n8n instance only if you hit the known dependency issue below (which needs the `--external-n8n` workaround) or you'd simply rather manage n8n yourself. Two common options:

- **Global/npx install** — needed for the `--external-n8n` workaround below, since it shares your host filesystem with `n8n-node`'s custom nodes folder:
  ```bash
  npm install -g n8n
  n8n start
  # or, without installing anything: npx n8n
  ```
- **Docker** — see n8n's own [Docker installation docs](https://docs.n8n.io/hosting/installation/docker/) for the up-to-date command, e.g.:
  ```bash
  docker volume create n8n_data
  docker run -it --rm --name n8n -p 5678:5678 -v n8n_data:/home/node/.n8n docker.n8n.io/n8nio/n8n
  ```
  Note that pointing a Dockerized n8n at this repo's build output needs extra volume-mounting/`docker cp` steps beyond the `--external-n8n` workaround below — see `.agents/workflow.md` for a worked example.

Either way, n8n is served at [http://localhost:5678](http://localhost:5678).

### Run n8n locally with the node loaded

```bash
git clone https://github.com/deepset-ai/deepset-n8n-nodes.git
cd deepset-n8n-nodes
npm install                        # installs deps for every package in the workspace

cd packages/haystack-enterprise
npm run dev                        # builds the node, symlinks it into n8n's custom
                                    # nodes folder, and starts n8n at http://localhost:5678
```

Open [http://localhost:5678](http://localhost:5678) and the node should be available in the nodes panel. `npm run dev` watches for changes and hot-reloads the node.

**Known issue:** bare `npm run dev` can fail with `Error: Command "start" not found`. This is caused by an upstream dependency conflict in n8n's bundled AI/langchain nodes, not by this package (see `.agents/workflow.md` for the full root cause). If you hit it, run in external mode instead and point your own n8n instance (the global/npx install from above) at the same custom nodes folder:

```bash
npm run dev -- --external-n8n

# in another terminal, with the n8n install from above:
N8N_DEV_RELOAD=true N8N_USER_FOLDER=~/.n8n-node-cli n8n start
```

### Example workflows

[`test/examples/`](./test/examples) has ready-made workflows for trying out the node once it's loaded into your n8n instance:

- [`search-stream-example.json`](./test/examples/search-stream-example.json) — a form-triggered workflow that submits a question straight to **Search (Streaming)** and shows the answer. The simplest example to start with.
- [`chat-with-auto-created-search-session-example.json`](./test/examples/chat-with-auto-created-search-session-example.json) — the simplest chat workflow: leaves **Search Session ID** empty and lets **Chat (Streaming)** create one automatically, remembering the returned ID for the rest of the conversation.
- [`chat-with-search-session-example.json`](./test/examples/chat-with-search-session-example.json) — the same conversation-history pattern, but managing the **Search Session** explicitly (create/list/delete) instead of relying on auto-creation.
- [`agent-with-chat-and-search-tools-example.json`](./test/examples/agent-with-chat-and-search-tools-example.json) — an AI Agent with two separate tool instances of this node, one running **Search (Streaming)** against a search-tuned service and one running **Chat (Streaming)** against a chat-tuned service, so it can pick whichever fits the user's request.
- [`mirror-files-in-google-drive-example.json`](./test/examples/mirror-files-in-google-drive-example.json) — a nightly scheduled workflow that diffs a Google Drive folder against files already indexed in Haystack Enterprise, uploading new files, updating changed ones, deleting removed ones, and waiting for indexing to finish before reporting.

To import one: in the n8n editor, open the menu (**⋮** in the top right) → **Import from File**, and select the JSON file. You'll still need to fill in your own credentials, and any service-specific nodes (e.g. Google Drive, OpenAI Chat Model) with your own credentials/settings.

These were exported from a local dev setup where the node is loaded via n8n's `CUSTOM` custom-nodes folder (see `.agents/workflow.md`), so their Haystack Enterprise node `type` fields use the `CUSTOM.` prefix.

## Operations

The node exposes the following resources:

- **File** — Upload, Get, Get Many, Get Meta, Update Meta, Update Meta Bulk, Delete, Delete Many
- **Index** — Get, Get Many
- **Search Session** — Create, Get Many, Delete
- **Service** — Get, Get Many, Search (Streaming), Chat (Streaming)

## Credentials

You need a Haystack Enterprise API credential, which requires an API key:

1. In Haystack Enterprise Platform, go to Settings → API Keys and generate a key.
2. In n8n, create a "Haystack Enterprise API" credential and paste the key in.

Use a workspace- or organization-level key with sufficient permissions for
the operations and resources you plan to use.

## Compatibility

This node has no known version incompatibilities and is eligible for n8n
Cloud. Its companion package,
[n8n-nodes-haystack-enterprise-mcp](https://www.npmjs.com/package/n8n-nodes-haystack-enterprise-mcp),
is self-hosted-only — see that package's README.

## Usage

### Chat and search sessions

The Chat (Streaming) operation takes an optional **Search Session ID**, used to store a chat history. Leave it empty on the first message and the node starts a session automatically, returning its ID in the output's `search_session_id` field — feed that back into **Search Session ID** on the next Chat call to continue the conversation. To manage sessions explicitly instead (e.g. to list or delete them later), create one with the **Search Session** resource's **Create** operation and pass its ID in from the start.

### One-off answers with Search (Streaming)

Not every use case is a conversation. For a single self-contained answer — a long summary, a one-time question, a report — use **Search (Streaming)** (the `search-stream` endpoint) instead of Chat. It retrieves from whatever files/documents are already indexed in the workspace and generates the answer itself, so the query is a question or instruction rather than pasted-in content. It needs no search session at all, and with **Simplify Output** enabled the node returns one item with the fully concatenated answer, ready to feed straight into the next node.

### Using Chat and Search as AI Agent tools

This node sets `usableAsTool: true`, so any operation can be connected to an AI Agent's Tool input instead of the main flow — the agent decides whether and when to call it, and with what arguments, based on the conversation.

## Linting

```bash
npm run lint       # from packages/haystack-enterprise
npm run lint:fix
```

This package is n8n-Cloud-eligible, so `lint`/`lint:fix` run in two passes: n8n's cloud-eligible ruleset over `nodes credentials package.json` (the code that actually ships), then the non-cloud ruleset (`eslint.test.config.mjs`) over `test/`, since that ruleset would otherwise flag `test/`'s `vitest` import as a cloud violation — see the "Known issues" section in `.agents/workflow.md` for why. Run from the repo root instead to lint every package in the workspace: `npm run lint` / `npm run lint:fix`.

## Testing

```bash
npm run test        # from packages/haystack-enterprise, runs vitest
```

Or from the repo root, to run tests for every package in the workspace: `npm run test`.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Haystack Enterprise Platform docs](https://docs.cloud.deepset.ai/)

## Version history

* **0.1.0** — Initial release.
