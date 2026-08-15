# MCP — connecting Claude to Transformer DNA

Transformer DNA exposes a small, read-only [Model Context Protocol](https://modelcontextprotocol.io) server so
Claude can answer real questions about the fleet — health, load, defects, warranty, manufacturers — directly
against live data, without anyone exporting a spreadsheet first.

## What it is (and isn't)

- **Read-only.** Every tool queries the database. None of them create, update, or delete anything. There is no
  tool that can touch a transformer's status, dispatch a unit, or edit a record.
- **No personal data leaves the system.** Tools never return a real person's name, PIN, or password. Nothing in
  the 8 tools below currently surfaces an individual's identity at all — inspection/upload/test records are
  returned without an inspector field. If a future tool needs to reference *who* did something, it must go through
  `maskEngineerName()` (`src/lib/mcp/masking.ts`), which renders an id as `Engineer #A1B2C` instead of a name. The
  admin-only access log (below) is the one place real names appear, and that's an internal audit view Claude never
  sees.
- **Scoped by role.** An admin can switch MCP off entirely, or lock it out for Manager or Store Keeper specifically.
  Field Engineer access is off by default.
- **Rate limited.** 400 tool calls per hour per access token by default (admin-configurable).

Every call — success or failure — is written to an access log visible on the settings page.

## The 8 tools

All tools live in `src/lib/mcp/tools.ts`. Each one validates its input with Zod and returns a plain JSON object —
never a raw database row.

### 1. `analyze_transformer_health`
Full health picture for one transformer.

| param | type | required |
|---|---|---|
| `gNumber` | string | yes — e.g. `"G-153457"` or `"153457"` |

Returns health status (HEALTHY/BREATHING/SURVIVING/CRITICAL/DECEASED), electrical & physical stress scores, phase
loading, hot-spot temperature, insulation ageing rate, estimated time to failure, the last KYN inspection, and the
5 most recent alerts.

> *"How healthy is G-153457?"*

### 2. `find_failing_transformers`
Worst-first list of transformers in trouble.

| param | type | required |
|---|---|---|
| `region` | string | no |
| `manufacturer` | string | no — partial match |
| `minAgeingRate` | number | no — only include units ageing at least this many times faster than normal |

> *"Which transformers in Nairobi West are closest to failing?"*

### 3. `compare_manufacturers`
No parameters. Per-manufacturer failure rate, average service life, warranty claim counts, most common fault, and
insulation (IR/BDV) decline rate, plus the fleet-wide average failure rate for comparison.

> *"Which manufacturer's transformers fail the most?"*

### 4. `analyze_load_pattern`
Per-phase load detail for one transformer.

| param | type | required |
|---|---|---|
| `gNumber` | string | yes |

Returns L1/L2/L3 (Red/Yellow/Blue, per KPLC convention) currents, % of rated capacity, phase unbalance, neutral
current, minutes over 100% load in the last hour, and — if one phase is overloaded — a concrete load-balancing
recommendation (how many amps to move, from which phase to which).

> *"Is G-153457's load balanced across phases?"*

### 5. `list_inspection_defects`
Safety defects found during KYN substation inspections.

| param | type | required |
|---|---|---|
| `region` | string | no |
| `defectType` | `"rotten_poles" \| "open_earths" \| "fuse_carriers" \| "all"` | no — defaults to `"all"` |

Sorted worst-first (open earths > rotten poles > leaning poles > fuse carriers needing replacement).

> *"List all open earth faults found in the last inspection round."*

### 6. `get_fleet_summary`
Fleet-wide (or region-scoped) totals.

| param | type | required |
|---|---|---|
| `region` | string | no — omit for the whole fleet |

Returns totals by transformer status, totals by health level, inspection compliance %, and open warranty claim
value in KES.

> *"Give me a fleet health summary for the whole network."*

### 7. `analyze_warranty_claims`
Warranty claim listing and totals.

| param | type | required |
|---|---|---|
| `manufacturer` | string | no — partial match |
| `status` | `"OPEN" \| "SUBMITTED" \| "APPROVED" \| "REJECTED" \| "CLOSED"` | no |

Returns each matching claim (fault reason, KES value, days remaining on the transformer's warranty) plus the total
recoverable value across still-open claims.

> *"How much can we still recover from PANFRICA under warranty?"*

### 8. `search_transformers`
Free-text search.

| param | type | required |
|---|---|---|
| `query` | string | yes — matches G-Number, serial number, site/location, or manufacturer |

## Connecting Claude

There are two ways to connect, depending on where Claude is running.

### Remote (Claude Desktop or claude.ai — recommended)

1. Sign in to Transformer DNA and open **MCP** in the sidebar (Admin, Manager, and Store Keeper all see it).
2. Copy the server URL shown there (`https://<your-deployment>/api/mcp`).
3. In Claude, go to **Settings → Connectors → Add custom connector** and paste the URL.
4. Claude opens your browser to `/mcp` for sign-in (using your normal Transformer DNA PIN login) and asks you to
   approve the connection. Approve it, and Claude is connected — no API key needed.

This uses a standard OAuth 2.1 flow: dynamic client registration, PKCE (S256), and a short-lived authorization
code exchanged for a 30-day access token. If Claude ever needs an API key instead of the browser flow (some
clients don't support OAuth yet), the settings page can generate one under **My API keys** — shown once, so copy
it immediately.

### Local (stdio) — running the repo directly

If you're running Claude Desktop on the same machine as a checkout of this repo, you can run the MCP server as a
local subprocess instead of over HTTP:

```json
{
  "mcpServers": {
    "transformer-pulse": {
      "command": "npx",
      "args": ["tsx", "mcp-server.ts"],
      "cwd": "/absolute/path/to/transformer-pulse"
    }
  }
}
```

Add that to `claude_desktop_config.json` (the settings page has a "Copy Config" button with your path filled in)
and restart Claude Desktop. `mcp-server.ts` at the project root uses the official
`@modelcontextprotocol/sdk` stdio transport, connects to the same database via Prisma, and registers the same 8
tools. It refuses to start if MCP has been switched off in the admin settings.

## The settings page (`/mcp`)

Visible to Admin, Manager, and Store Keeper (Field Engineer access is a separate, off-by-default toggle an admin
can turn on).

- **Connection status pill** — green/red, reflecting the global enable switch.
- **Global controls** (admin-only edit; everyone else sees them read-only): master enable/disable, per-role access
  toggles (Manager / Store Keeper / Field Engineer), and the hourly rate limit. Admin access can never be locked
  out from here — whoever can disable MCP must always be able to re-enable it.
- **Connect Claude** — the remote URL and the local stdio config, each with a copy button, plus a **Test
  Connection** button that checks the database is reachable, MCP is enabled, and your role is allowed through.
  (It confirms the server is *ready*, not that a specific client's OAuth handshake succeeded — that requires an
  actual browser round-trip, which a settings page can't simulate.)
- **My API keys** — generate a manual long-lived key (shown once) or revoke one you no longer use.
- **Access log** — every tool call, success or failure, with the tool name, auth method, and timestamp. Admin sees
  everyone's; everyone else sees only their own.

## How the pieces fit together

```
mcp-server.ts                    stdio transport, official SDK, for local Claude Desktop
src/app/api/mcp/route.ts         HTTP transport (JSON-RPC 2.0), for remote clients
src/app/api/mcp/oauth/*          register / authorize / token — OAuth 2.1 + PKCE
src/app/api/mcp-well-known/*     OAuth discovery metadata (rewritten from /.well-known/* in next.config.ts)
src/lib/mcp/tools.ts             the 8 tools, shared by both transports
src/lib/mcp/settings.ts          global + per-role enable/disable, rate limit
src/lib/mcp/tokens.ts            auth codes + access tokens (signed JWT, reusing src/lib/jwt.ts)
src/lib/mcp/masking.ts           Engineer #ABCDE — for if a future tool needs to reference a person
src/app/(app)/mcp/page.tsx       the settings page
```

The remote HTTP route auto-detects how a client is authenticating: an `Authorization: Bearer` header means OAuth,
an `X-API-Key` header or `?key=` query param means a manual key. If neither is present, it replies `401` with a
`WWW-Authenticate: Bearer resource_metadata="…"` header — the exact signal Claude Desktop looks for to kick off
the OAuth flow automatically rather than asking a person to paste in a key.

**Architectural note:** the remote transport is a hand-written JSON-RPC 2.0 handler rather than the SDK's
`StreamableHTTPServerTransport`, because that transport expects raw Node `http.IncomingMessage`/`ServerResponse`
objects and doesn't map cleanly onto Next.js's Fetch-API route handlers. The stdio path (`mcp-server.ts`) *does*
use the official SDK's `McpServer` + `StdioServerTransport`, since stdio is exactly the transport those are built
for.

**Auth note:** this app doesn't use NextAuth — it has its own PIN + signed-JWT session system
(`src/lib/auth.ts`, `src/lib/session.ts`). Rather than bolt on a separate auth library, the OAuth layer reuses the
app's existing hand-rolled JWT primitive (`src/lib/jwt.ts`) for both the authorization code and the access token,
backed by two small new tables (`McpOAuthClient` for registered redirect URIs, `McpToken` for revocable,
rate-limited, auditable access tokens). There's no refresh-token grant — the access token itself is long-lived
(30 days), so nothing needs refreshing before then.

## Adding a new tool

1. Add a Zod input schema and an `async function` handler to `src/lib/mcp/tools.ts`, following the existing
   pattern: parse input, query via Prisma or an existing lib function, return a plain object (never a raw row,
   never a real person's name).
2. Hand-write a matching `jsonSchema` entry — don't try to derive it from the Zod schema. Zod's internal shape
   changes between major versions; a schema-introspection helper would silently start handing clients a wrong tool
   description on the next `zod` bump while validation kept working underneath it.
3. Push an entry onto `MCP_TOOLS`. Both transports (`mcp-server.ts` and `src/app/api/mcp/route.ts`) read from this
   one array, so nothing else needs to change.
4. Run `npx tsc --noEmit` and try the tool from Claude.
