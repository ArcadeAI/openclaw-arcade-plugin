<h3 align="center">
  <a name="readme-top"></a>
  <img
    src="https://docs.arcade.dev/images/logo/arcade-logo.png"
    style="width: 400px;"
  >
</h3>

# Arcade OpenClaw Plugin

Connect OpenClaw to [Arcade.dev](https://arcade.dev) for access to **authorized tools** across hundreds of services including Gmail, Slack, GitHub, Google Calendar, Notion, Linear, Jira, Stripe, HubSpot, and more.

## Features

- **Curated Default Tools**: ~130 tools from 25 popular toolkits enabled out of the box, expandable to 7000+
- **Automatic OAuth**: Arcade handles all authorization flows securely
- **Toolkit-Level Auth**: Authorize all tools in a toolkit (e.g., all Gmail tools) with a single OAuth flow
- **Dynamic Registration**: Tools are automatically discovered and registered
- **JIT Authorization**: Prompts users to authorize when needed, with choice of toolkit or individual tool
- **Tool Filtering**: Control which tools are available via allowlists/denylists
- **CLI Commands**: Manage tools and authorization from the command line

## Installation

Clone the plugin and install it:

```bash
git clone --depth 1 https://github.com/ArcadeAI/openclaw-arcade-plugin /tmp/openclaw-arcade
openclaw plugins install /tmp/openclaw-arcade/arcade
```

Then add `arcade` to your trusted plugins in `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    allow: ["arcade"]
  }
}
```

Without this, OpenClaw will log a warning on every startup about untrusted non-bundled plugins.

## Configuration

### Setting Up Credentials

Get an API key from the [Arcade Dashboard](https://docs.arcade.dev/en/get-started/setup/api-keys).

**Method 1 (Recommended): Interactive credentials setup**

```bash
openclaw arcade credentials setup
```

This prompts for your API key (input is hidden) and user ID interactively. Nothing is stored in shell history. Credentials are saved to `~/.openclaw/credentials/arcade.json` with `chmod 600` permissions.

For scripted/automated setup, use a credentials file:

```bash
openclaw arcade credentials setup --from /path/to/creds.json
```

Where the file contains `{"apiKey": "arc_...", "userId": "user@example.com"}`.

**Method 2: OpenClaw `.env` file**

Create `~/.openclaw/.env` using a text editor (not shell commands — those leak to history):

```
ARCADE_API_KEY=arc_...
ARCADE_USER_ID=user@example.com
```

Then restrict permissions: `chmod 600 ~/.openclaw/.env`

OpenClaw auto-loads `~/.openclaw/.env` at gateway startup. The plugin reads credentials from `process.env`.

**Method 3: Config with variable interpolation**

If your env vars are set by a process manager (systemd, Docker, etc.):

```json5
{
  plugins: {
    entries: {
      arcade: {
        config: {
          apiKey: "${ARCADE_API_KEY}",
          userId: "${ARCADE_USER_ID}"
        }
      }
    }
  }
}
```

The gateway resolves `${VAR}` at load time — the actual key is never stored in the config file.

### Credential Resolution Order

The plugin checks these sources in order (first match wins):

1. Plugin config value (may already be resolved from `${ENV_VAR}` by the gateway)
2. Credentials file (`~/.openclaw/credentials/arcade.json`)
3. Environment variables (`ARCADE_API_KEY`, `ARCADE_USER_ID`)

### Initialize and Start

```bash
openclaw arcade init        # Cache all available tools
openclaw gateway restart    # Restart to load the plugin
```

## Security Hardening

> **Important:** The Arcade API key grants access to Arcade's full API, including the ability to retrieve third-party OAuth tokens. If the AI agent obtains the API key, it can directly call Arcade API endpoints and acquire OAuth access tokens for any connected service (Gmail, Slack, GitHub, etc.). **You must keep the API key out of the agent's reach.**

### Where NOT to Store Credentials

| Location | Attack Vector |
|----------|---------------|
| `~/.openclaw/openclaw.json` | Agent reads via `gateway` tool or file read tools |
| `~/.zshrc`, `~/.bashrc`, `~/.profile` | Agent reads shell profiles via file tools |
| CLI arguments (`--api-key arc_...`) | Appears in shell history (`~/.zsh_history`) which the agent can read |
| `openclaw config set ...apiKey "arc_..."` | Writes raw key to config file AND appears in shell history |
| `.env` files in workspace directories | Agent can read workspace files |

**Safe locations:** The dedicated credentials file (`openclaw arcade credentials setup`), the global `.env` file (`~/.openclaw/.env` with `chmod 600`), or config interpolation with env vars set by a process manager.

### Recommended OpenClaw Configuration

Add the following to your OpenClaw gateway configuration to prevent the agent from accessing configuration files, running shell commands, or calling external APIs directly:

```json5
{
  agents: {
    defaults: {
      // Run tools in a sandbox — blocks file system access to config/credential files
      sandbox: {
        mode: "all",
        workspaceAccess: "none"
      },
      // Deny tools that could expose credentials or bypass the plugin
      tools: {
        deny: [
          "gateway",          // Prevents reading/modifying gateway config
          "cron",             // Prevents scheduling tasks
          "exec",             // Prevents running shell commands (curl, cat, etc.)
          "process",          // Prevents process management
          "browser",          // Prevents web browsing (could hit Arcade API directly)
          "sessions_spawn",   // Prevents spawning new sessions
          "sessions_send"     // Prevents sending to other sessions
        ]
      }
    }
  },
  // Keep tool output redaction enabled (default)
  logging: {
    redactSensitive: "tools"
  }
}
```

### File Permissions

```bash
# OpenClaw directories and config
chmod 700 ~/.openclaw
chmod 600 ~/.openclaw/openclaw.json
chmod 600 ~/.openclaw/.env              # If using .env method

# Arcade credentials and cache
chmod 700 ~/.openclaw/credentials
chmod 600 ~/.openclaw/credentials/arcade.json
chmod 700 ~/.arcade
chmod 600 ~/.arcade/openclaw.json
```

### Best Practices

1. **Use `openclaw arcade credentials setup`** — interactive prompt, nothing in shell history
2. **Enable sandbox mode** to block file system access to config directories
3. **Deny dangerous tools** (`gateway`, `exec`, `process`, `browser`) to prevent the agent from reading files or calling APIs directly
4. **Keep `redactSensitive`** enabled to prevent credentials from appearing in tool output logs
5. **Clear command history** if you ever ran `openclaw config set ...apiKey` with the key value

## Default Tools

By default, the plugin enables ~130 tools from 25 curated, popular toolkits:

| Category | Toolkits |
|----------|----------|
| **Productivity** | Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets, Notion, Asana, Linear, Jira |
| **Communication** | Slack, Discord, Microsoft Teams, Outlook, Zoom |
| **Development** | GitHub, Figma |
| **Business** | Stripe, HubSpot, Salesforce, Zendesk, Intercom |
| **Search & Data** | Google Search, Google News, Firecrawl, PostgreSQL, MongoDB |

### Expanding Available Tools

To enable **all** Arcade tools (7000+):

```json5
{
  plugins: {
    entries: {
      arcade: {
        config: {
          useDefaultAllowlist: false,  // Disable curated defaults
          useApiTools: true            // Include comprehensive *Api toolkits
        }
      }
    }
  }
}
```

To enable specific additional toolkits:

```json5
{
  plugins: {
    entries: {
      arcade: {
        config: {
          tools: {
            allow: ["Gmail.*", "Slack.*", "GitHub.*", "X.*", "Reddit.*"]
          }
        }
      }
    }
  }
}
```

To restrict to fewer tools:

```json5
{
  plugins: {
    entries: {
      arcade: {
        config: {
          tools: {
            allow: ["Gmail.*", "GoogleCalendar.*"],
            deny: ["Gmail.DeleteEmail"]
          }
        }
      }
    }
  }
}
```

Note: When `tools.allow` is explicitly set, it takes precedence over `useDefaultAllowlist`.

## Authorization Flow

When a tool requires OAuth authorization:

1. **User invokes a tool** (e.g., "Send an email via Gmail")
2. **Auth check**: The plugin checks if the user is authorized for that tool
3. **Two options presented**:
   - **Authorize all tools in the toolkit** — A single OAuth URL with combined scopes for all tools in that toolkit (e.g., all Gmail permissions at once)
   - **Authorize only this tool** — A narrower OAuth URL for just the specific tool
4. **User visits the URL**, completes the OAuth login, and tells OpenClaw they're done
5. **Tool execution proceeds** automatically

### Pre-Authorize via CLI

You can pre-authorize toolkits before using them in conversation:

```bash
# Authorize all tools in a toolkit at once
openclaw arcade auth login-toolkit Gmail
openclaw arcade auth login-toolkit Slack

# Authorize a specific tool
openclaw arcade auth login Gmail.SendEmail

# Check authorization status
openclaw arcade auth status
openclaw arcade auth status --tool Gmail.SendEmail
```

## Agent Tools

The plugin registers auto-discovered tools using the naming convention `arcade_<toolkit>_<tool_name>`:

- `Gmail.SendEmail` -> `arcade_gmail_send_email`
- `Slack.PostMessage` -> `arcade_slack_post_message`
- `GitHub.CreateIssue` -> `arcade_github_create_issue`

Plus three utility tools:

- `arcade_list_tools` — List available tools (respects configured filters)
- `arcade_authorize` — Pre-authorize a tool (respects configured filters)
- `arcade_execute` — Execute any allowlisted tool by name

## CLI Commands

```bash
# Credential management (never pass credentials as CLI arguments)
openclaw arcade credentials setup          # Interactive prompt (recommended)
openclaw arcade credentials setup --from /path/to/creds.json
openclaw arcade credentials show           # Shows status, never values
openclaw arcade credentials clear

# Initialize/refresh tool cache
openclaw arcade init
openclaw arcade init --force

# List available tools
openclaw arcade tools list
openclaw arcade tools list --toolkit Gmail
openclaw arcade tools list --all

# Search for tools
openclaw arcade tools search email

# Get tool info
openclaw arcade tools info Gmail.SendEmail

# Execute a tool
openclaw arcade tools execute Gmail.SendEmail -i '{"recipient":"test@example.com","subject":"Hello","body":"Test"}'

# Authorization management
openclaw arcade auth status
openclaw arcade auth login Gmail.SendEmail
openclaw arcade auth login-toolkit Gmail
openclaw arcade auth revoke <connectionId>

# Configuration and health
openclaw arcade config
openclaw arcade health

# Cache management
openclaw arcade cache
openclaw arcade cache --clear
```

## Config Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | string | — | Arcade API key (required). Use `openclaw arcade credentials setup` — see [Configuration](#configuration). |
| `userId` | string | — | User ID for authorization. Use `openclaw arcade credentials setup` — see [Configuration](#configuration). |
| `baseUrl` | string | `https://api.arcade.dev` | API base URL |
| `toolPrefix` | string | `arcade` | Prefix for tool names |
| `autoAuth` | boolean | `true` | Auto-prompt for authorization when needed |
| `cacheToolsTtlMs` | number | `300000` | Tool cache TTL in ms (5 min) |
| `useApiTools` | boolean | `false` | Include comprehensive *Api toolkits (7000+ tools) |
| `useDefaultAllowlist` | boolean | `true` | Restrict to curated toolkits when no `tools.allow` is set |
| `tools.allow` | string[] | — | Allowlist patterns (e.g., `Gmail.*`, `Slack.PostMessage`) |
| `tools.deny` | string[] | — | Denylist patterns |
| `toolkits.<id>.enabled` | boolean | `true` | Enable/disable a specific toolkit |

## Development

```bash
cd arcade
pnpm install
pnpm test
pnpm build
```

## License

MIT
