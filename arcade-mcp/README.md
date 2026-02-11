# Arcade MCP Gateway Plugin for OpenClaw

Connect OpenClaw to one or more MCP gateways using header-based authentication.
The gateway governs which tools are exposed — this plugin discovers and proxies them.

> **Note:** This plugin is independent of the [REST API plugin](../arcade/).
> Use one or the other — not both. See [Comparison](#comparison-with-the-rest-api-plugin) below.

## Install from branch

This plugin lives on the `feat/arcade-mcp-gateway` branch.

```bash
# Clone the branch
git clone --depth 1 -b feat/arcade-mcp-gateway \
  https://github.com/ArcadeAI/openclaw-arcade-plugin.git \
  /tmp/openclaw-arcade-mcp

# Install the plugin into your OpenClaw gateway
openclaw plugins install /tmp/openclaw-arcade-mcp/arcade-mcp

# Restart the gateway
openclaw gateway restart
```

## Configuration

Every gateway is explicitly configured. No URLs, credentials, or endpoints are assumed.

Edit `~/.openclaw/openclaw.json`:

### Multiple Gateways

```json5
{
  plugins: {
    entries: {
      "arcade-mcp": {
        enabled: true,
        config: {
          gateways: {
            // Sales team — CRM and email tools
            sales: {
              url: "https://api.arcade.dev/mcp/sales",
              headers: {
                "Authorization": "Bearer arc_sales_key_here",
                "Arcade-User-ID": "sales-ops@company.com"
              }
            },
            // Marketing team — campaign and analytics tools
            marketing: {
              url: "https://api.arcade.dev/mcp/marketing",
              headers: {
                "Authorization": "Bearer arc_marketing_key_here",
                "Arcade-User-ID": "marketing@company.com"
              }
            },
            // Support team — ticketing and customer tools
            support: {
              url: "https://api.arcade.dev/mcp/support",
              headers: {
                "Authorization": "Bearer arc_support_key_here",
                "Arcade-User-ID": "support@company.com"
              }
            }
          }
        }
      }
    }
  }
}
```

This registers tools like:

- `sales_hubspot_create_contact` — from the sales gateway
- `marketing_mailchimp_send_campaign` — from the marketing gateway
- `support_zendesk_create_ticket` — from the support gateway

### Single Gateway

```json5
{
  plugins: {
    entries: {
      "arcade-mcp": {
        config: {
          gateways: {
            sales: {
              url: "https://api.arcade.dev/mcp/sales",
              headers: {
                "Authorization": "Bearer arc_your_key",
                "Arcade-User-ID": "you@example.com"
              }
            }
          }
        }
      }
    }
  }
}
```

## Gateway Config Reference

Each entry in `gateways` accepts:

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | **Yes** | MCP gateway endpoint URL |
| `headers` | object | **Yes** | HTTP headers sent with every MCP request |
| `enabled` | boolean | No | Enable/disable this gateway (default: `true`) |
| `toolPrefix` | string | No | Override the tool-name prefix (default: gateway key) |

Plugin-level options:

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch for the plugin |
| `requestTimeoutMs` | number | `30000` | Timeout for individual MCP requests (ms) |

## Usage

### Chat Commands

```
/arcade-mcp                  Show gateway connection status
/arcade-mcp status           Same as above
/arcade-mcp tools            List all tools from all gateways
/arcade-mcp tools sales      List tools from the "sales" gateway only
/arcade-mcp gateways         Show gateway summary
```

### CLI

```bash
openclaw arcade-mcp:status                    # Connection status
openclaw arcade-mcp:tools                     # All registered tools
openclaw arcade-mcp:tools --gw sales          # Tools from "sales" only
openclaw arcade-mcp:tools --json              # JSON output
openclaw arcade-mcp:refresh                   # Re-fetch tool lists
openclaw arcade-mcp:reconnect                 # Reconnect all gateways
openclaw arcade-mcp:reconnect --gw sales      # Reconnect one gateway
```

### Gateway RPC

```bash
openclaw gateway call arcade-mcp.status --params '{}'
openclaw gateway call arcade-mcp.tools.list --params '{"gateway": "sales"}'
openclaw gateway call arcade-mcp.refresh --params '{}'
```

## How It Works

1. Plugin reads the `gateways` map — each entry has a `url` and `headers`.
2. Connects to each gateway via MCP Streamable HTTP transport (falls back to SSE).
3. Sends the configured `headers` with every MCP request.
4. Discovers tools via MCP `tools/list`.
5. Converts MCP tool schemas (JSON Schema) to OpenClaw tools (TypeBox).
6. Registers tools with gateway-key prefixes (e.g., `sales_`, `marketing_`, `support_`).
7. Tool calls are routed through the originating gateway's MCP connection via `tools/call`.

The gateway decides which tools are visible — there is no client-side filtering.

## Comparison with the REST API Plugin

| | [REST API Plugin](../arcade/) | MCP Gateway Plugin (this) |
|---|---|---|
| **Protocol** | Arcade REST API via `@arcadeai/arcadejs` | MCP (Streamable HTTP / SSE) |
| **Tool governance** | Client-side allow/deny lists | **Gateway-side** — admin controls what's exposed |
| **Credentials** | `apiKey` + `userId` in config | **Any headers** — opaque to the plugin |
| **Endpoints** | Hardcoded to Arcade API | **User-provided** — works with any MCP gateway |
| **Multi-gateway** | No | **Yes** — each gateway is an independent connection |
| **OAuth / JIT auth** | Built-in `before_tool_call` hooks | Delegated to the gateway |
| **Tool caching** | Local file cache (`~/.arcade/`) | In-memory (from MCP `tools/list`) |
| **CLI namespace** | `openclaw arcade …` | `openclaw arcade-mcp:…` |
| **Chat command** | `/arcade` | `/arcade-mcp` |

**When to use the REST API plugin:** You want the simplest setup with a single Arcade account
and built-in OAuth prompts.

**When to use the MCP Gateway plugin:** You want centralized governance, multiple gateways
with different access levels, or need to connect to non-Arcade MCP endpoints.

## License

MIT
