# @deepset-ai/n8n-nodes-haystack-enterprise-mcp

This is an n8n community node. It lets you use pipelines you've enabled as MCP tools on a
[Haystack Enterprise Platform](https://www.deepset.ai/haystack-platform) workspace as tools for an
n8n AI Agent.

New to Haystack Enterprise Platform? Start with the
[getting started guide](https://docs.cloud.deepset.ai/docs/getting-started).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

## Contents

- [Supported n8n versions](#supported-n8n-versions)
- [Installation](#installation)
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
`@deepset-ai/n8n-nodes-haystack-enterprise-mcp`.

This package is **not n8n-verified**: it depends on external libraries (the MCP SDK and LangChain
core), which verified community nodes can't do. n8n therefore asks you to confirm that you trust the
package when you install it, and it can't be installed on n8n Cloud. Community nodes must be enabled
on your n8n instance. For the verified Haystack Enterprise nodes, see
[`@deepset-ai/n8n-nodes-haystack-enterprise`](https://www.npmjs.com/package/@deepset-ai/n8n-nodes-haystack-enterprise).

**This node is only supported on self-hosted n8n.** It is not available on n8n Cloud and refuses to
run there (the node checks n8n's own `N8N_DEPLOYMENT_TYPE` environment variable at runtime).

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

## Example workflows

The example workflow is not part of the npm package. It lives in the repository, in
[`packages/haystack-enterprise-mcp/test/examples/`](https://github.com/deepset-ai/deepset-n8n-nodes/tree/main/packages/haystack-enterprise-mcp/test/examples):

- [`ai-agent-with-mcp-tools-example.json`](./test/examples/ai-agent-with-mcp-tools-example.json) —
  an AI Agent with this node wired into its Tools input, exposing the workspace's enabled pipelines
  directly to the agent.

To use it, either open the file on GitHub, click **Copy raw file**, and paste it onto the n8n canvas
(Ctrl/Cmd+V), or clone the repository and, in the n8n editor, open the menu (**⋮** in the top right)
→ **Import from File** and select the JSON file. You'll still need to fill in your own credentials
(including the OpenAI Chat Model node's) and select your own workspace on the Haystack Enterprise
MCP node.

## Credentials

The node's **Authentication** dropdown offers two ways to authenticate.

### API Key

Choose **API Key** on the node (the default) and create a "Haystack Enterprise API" credential:

1. In [Haystack Enterprise Platform](https://cloud.deepset.ai/), go to Settings → API Keys and
   generate a key. See [Generate an API key](https://docs.cloud.deepset.ai/docs/generate-api-key).
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
- [Haystack Enterprise Platform](https://cloud.deepset.ai/)
- [Haystack Enterprise Platform docs](https://docs.cloud.deepset.ai/)

## Version history

See the [changelog](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/CONTRIBUTING.md).
Report security issues as described in
[SECURITY.md](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/SECURITY.md).
