# @deepset-ai/n8n-nodes-haystack-enterprise-mcp

This is an n8n community node. It lets you use pipelines you've enabled as MCP tools on a
[Haystack Enterprise Platform](https://www.deepset.ai/haystack-platform) workspace as tools for an
n8n AI Agent.

New to Haystack Enterprise Platform? Start with the
[getting started guide](https://docs.cloud.deepset.ai/docs/getting-started).

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

## Contents

- [Installation](#installation)
- [Operations](#operations)
- [Example workflows](#example-workflows)
- [Credentials](#credentials)
- [Resources](#resources)
- [Version history](#version-history)
- [Contributing](#contributing)

## Installation

This node works on **self-hosted n8n only** (2.16 or later in the 2.x series; we also check it
against the latest n8n release). It is not n8n-verified, so it can't run on n8n Cloud.

Enable community nodes on your instance, then follow the
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and enter the
package name `@deepset-ai/n8n-nodes-haystack-enterprise-mcp`.

Looking for the n8n-verified Haystack Enterprise nodes? See
[`@deepset-ai/n8n-nodes-haystack-enterprise`](https://www.npmjs.com/package/@deepset-ai/n8n-nodes-haystack-enterprise).

## Operations

The node connects to the MCP server of a Haystack Enterprise Platform workspace and exposes its
enabled pipelines as tools. Add it to the **Tools** input of an AI Agent, pick your workspace, and
the Agent can call your pipelines.

- **Workspace**: the workspace whose pipelines to expose.
- **Tools to Include**: which of the workspace's tools the Agent can use:
  - **All**: every tool (default).
  - **Selected**: only the tools you pick.
  - **All Except**: every tool except the ones you pick.
- **Options → Timeout**: how long to wait for a pipeline call, in ms (default 60000).

## Example workflows

Try the
[AI Agent with MCP tools example](https://github.com/deepset-ai/deepset-n8n-nodes/blob/main/packages/haystack-enterprise-mcp/test/examples/ai-agent-with-mcp-tools-example.json):
an AI Agent with this node wired into its Tools input.

To use it, open the file on GitHub, click **Copy raw file**, and paste it onto the n8n canvas
(Ctrl/Cmd+V). Then add your own credentials (including for the OpenAI Chat Model node) and select
your workspace on the Haystack Enterprise MCP node.

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
