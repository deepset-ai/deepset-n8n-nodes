# n8n-nodes-haystack-enterprise-mcp

This is an n8n community node. It lets you use pipelines you've enabled as MCP tools on a
[Haystack Enterprise Platform](https://cloud.deepset.ai/) workspace as tools for an n8n AI Agent.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

[Installation](#installation) [Example workflows](#example-workflows) [Operations](#operations)
[Credentials](#credentials) [Usage](#usage) [Resources](#resources)
[Version history](#version-history) [Contributing](#contributing)

## Supported n8n versions

This package supports n8n 2.16 and later in the 2.x series. We also check the package against the
latest n8n release.

## Installation

> **Status: not yet published to npm.** This package is not part of the first release and is not
> submitted for n8n verification. Until it is published, run it from a local checkout, see
> [CONTRIBUTING.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/CONTRIBUTING.md#local-development).

**This node is only supported on self-hosted n8n.** It is not available on n8n Cloud and refuses to
run there (the node checks n8n's own `N8N_DEPLOYMENT_TYPE` environment variable at runtime).

## Example workflows

[`test/examples/`](./test/examples) has a ready-made workflow for trying out the node once it's
loaded into your n8n instance:

- [`ai-agent-with-mcp-tools-example.json`](./test/examples/ai-agent-with-mcp-tools-example.json) —
  an AI Agent with this node wired into its Tools input, exposing the workspace's enabled pipelines
  directly to the agent.

To import it: in the n8n editor, open the menu (**⋮** in the top right) → **Import from File**, and
select the JSON file. You'll still need to fill in your own credentials (including the OpenAI Chat
Model node's) and select your own workspace on the Haystack Enterprise MCP node.

The example uses the node type of the npm package. To import it into a local dev instance, see
[CONTRIBUTING.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/CONTRIBUTING.md#local-development).

## Operations

The node connects to a Haystack Enterprise Platform MCP server and exposes its enabled pipelines to
an n8n AI Agent as tools:

- **Workspace** — select which Haystack Enterprise Platform workspace's MCP server to connect to.
- **Tools to Include** — choose how to select which of the workspace's enabled pipeline tools are
  exposed to the AI Agent: **All** (expose every tool), **Selected** (only expose the tools listed
  in **Tools to Include**), or **All Except** (expose all tools except those listed in **Tools to
  Exclude**).
- **Options → Timeout** — how long (in ms) to wait for a pipeline call to finish before failing it
  (default 60000).

## Credentials

The node's **Authentication** dropdown offers two ways to authenticate.

### API Key

Choose **API Key** on the node (the default) and create a "Haystack Enterprise API" credential:

1. In Haystack Enterprise Platform, go to Settings → API Keys and generate a key.
2. In n8n, paste the key into the credential. **Server URL** defaults to the hosted Haystack
   Enterprise Platform API (`https://api.cloud.deepset.ai`); for dev or private environments, set it
   to your instance's API origin.

The key needs at least workspace and search permissions.

### OAuth2 (sign in with your Haystack Enterprise account)

OAuth2 credentials require n8n 2.19.2 or later.

Choose **OAuth2** on the node and create a "Haystack Enterprise OAuth2 API" credential.

1. Leave **Server URL** at `https://api.cloud.deepset.ai`. The Server URL is the API origin the
   nodes use for requests and OAuth2 discovery; change it only for dev or private Haystack
   Enterprise deployments.
2. Click **Connect** and sign in with your Haystack Enterprise account.

**Manual OAuth2 configuration.** Turn **Use Dynamic Client Registration** off to configure or reuse
an existing OAuth2 client, including clients for private Haystack Enterprise deployments. Keep
**Server URL** pointed at the Haystack Enterprise API, fill in the OAuth2 settings, and register the
callback URL shown on the credential as a redirect URI on the client. Leave **Client Secret** empty
for a public PKCE client; confidential clients still require their secret.

## Usage

Add the node to an AI Agent's Tools input. Select your workspace, optionally restrict which pipeline
tools are exposed, and the Agent can then call your enabled pipelines directly.

### Testing a pipeline directly

You can also call one pipeline directly, without an Agent, by using the node's "Execute step" test
button: pass in an item shaped like `{ "tool": "<pipeline name>", ...arguments }` and it calls that
pipeline and returns its response. This is meant for smoke-testing the MCP connection and a
pipeline's arguments, not for wiring into a live workflow — this node has no Main input/output, so
it can't be connected as a regular step between other nodes (only via an AI Agent's Tools input, or
via "Execute step").

### "Custom API Call" option

You'll see a "Custom API Call" option at the bottom of some dropdowns. This is added automatically
by n8n to any node with a token/API-key credential — it's not something this node adds, and it has
no effect here. You can safely ignore it.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Use your pipelines as MCP tools](https://docs.cloud.deepset.ai/docs/use-pipeline-as-mcp-tool)

## Version history

See the [changelog](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/CONTRIBUTING.md).
Report security issues as described in
[SECURITY.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/SECURITY.md).
