# n8n-nodes-haystack-enterprise-mcp

This is an n8n community node. It lets you use pipelines you've enabled as MCP
tools on a [Haystack Enterprise Platform](https://cloud.deepset.ai/) workspace as tools for
an n8n AI Agent.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Local development](#local-development)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Linting](#linting)
[Testing](#testing)
[Resources](#resources)
[Releasing](#releasing)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation, and search for `n8n-nodes-haystack-enterprise-mcp`.

**This node is only supported on self-hosted n8n.** It is not available on n8n
Cloud and refuses to run there (the node checks n8n's own
`N8N_DEPLOYMENT_TYPE` environment variable at runtime).

## Local development

Use this if you want to run the node from a local checkout — e.g. to test unreleased changes — instead of installing the published package.

### Prerequisites

- Node.js and npm
- A running, **self-hosted** n8n instance to load the node into (a local Docker container, a global `n8n` install, or the one `n8n-node dev` can start for you) — this node refuses to run on n8n Cloud

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

cd packages/haystack-enterprise-mcp
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

[`test/examples/`](./test/examples) has a ready-made workflow for trying out the node once it's loaded into your n8n instance:

- [`ai-agent-with-mcp-tools-example.json`](./test/examples/ai-agent-with-mcp-tools-example.json) — an AI Agent with this node wired into its Tools input, exposing the workspace's enabled pipelines directly to the agent.

To import it: in the n8n editor, open the menu (**⋮** in the top right) → **Import from File**, and select the JSON file. You'll still need to fill in your own credentials (including the OpenAI Chat Model node's) and select your own workspace on the Haystack Enterprise MCP node.

This was exported from a local dev setup where the node is loaded via n8n's `CUSTOM` custom-nodes folder (see `.agents/workflow.md`), so its Haystack Enterprise MCP node `type` field uses the `CUSTOM.` prefix.

## Operations

The node connects to a Haystack Enterprise Platform MCP server and exposes its enabled pipelines
to an n8n AI Agent as tools:

- **Workspace** — select which Haystack Enterprise Platform workspace's MCP server to connect to.
- **Tools to Include** — choose how to select which of the workspace's enabled pipeline tools are exposed to the AI Agent: **All** (expose every tool), **Selected** (only expose the tools listed in **Tools to Include**), or **All Except** (expose all tools except those listed in **Tools to Exclude**).
- **Options → Timeout** — how long (in ms) to wait for a pipeline call to finish before failing it (default 60000).

## Credentials

You need a Haystack Enterprise API credential, which requires an API key:

1. In Haystack Enterprise Platform, go to Settings → API Keys and generate a key.
2. In n8n, create a "Haystack Enterprise API" credential and paste the key in.

The key needs at least workspace and search permissions.

This is the same credential type used by
[n8n-nodes-haystack-enterprise](https://www.npmjs.com/package/n8n-nodes-haystack-enterprise),
so if you have both packages installed you only need to configure it once. The
two packages currently duplicate the credential's source file by hand rather
than sharing it via a common dependency, because that dependency would make
`n8n-nodes-haystack-enterprise` ineligible for n8n Cloud (cloud-eligible
packages can't declare runtime dependencies). Once this package is also
cloud-eligible (or that restriction no longer applies), the two should be
unified into one shared package.

You'll also need to create an MCP server for your workspace and enable at
least one pipeline as a tool, under Settings → Workspace → MCP.

## Compatibility

Requires a self-hosted n8n instance. Not compatible with n8n Cloud.

## Usage

Add the node to an AI Agent's Tools input. Select your workspace, optionally
restrict which pipeline tools are exposed, and the Agent can then call your
enabled pipelines directly.

### Testing a pipeline directly

You can also call one pipeline directly, without an Agent, by using the
node's "Execute step" test button: pass in an item shaped like
`{ "tool": "<pipeline name>", ...arguments }` and it calls that pipeline and
returns its response. This is meant for smoke-testing the MCP connection and
a pipeline's arguments, not for wiring into a live workflow — this node has
no Main input/output, so it can't be connected as a regular step between
other nodes (only via an AI Agent's Tools input, or via "Execute step").

### "Custom API Call" option

You'll see a "Custom API Call" option at the bottom of some dropdowns. This is
added automatically by n8n to any node with a token/API-key credential — it's
not something this node adds, and it has no effect here. You can safely
ignore it.

## Linting

```bash
npm run lint       # from packages/haystack-enterprise-mcp
npm run lint:fix
```

This package isn't n8n-Cloud-eligible, so its single non-cloud ruleset can safely cover `nodes credentials package.json test` in one pass — unlike `packages/haystack-enterprise`, which needs a second, non-cloud config just for `test/`. Run from the repo root instead to lint every package in the workspace: `npm run lint` / `npm run lint:fix`.

## Testing

```bash
npm run test        # from packages/haystack-enterprise-mcp, runs vitest
```

Or from the repo root, to run tests for every package in the workspace: `npm run test`.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [Use your pipelines as MCP tools](https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool)

## Releasing

This package is released independently from its sibling package, gated by a `haystack-enterprise-mcp-v<version>` git tag. See the root [README's "Releasing" section](../../README.md#releasing) for the full process.

## Version history

* **0.1.0** — Initial release.
