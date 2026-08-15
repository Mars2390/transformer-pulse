import path from "node:path";
import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_TOOLS } from "./src/lib/mcp/tools";
import { getMcpSettings } from "./src/lib/mcp/settings";

// Load .env from this file's own directory, not process.cwd() — Claude
// Desktop spawns this process without necessarily setting the working
// directory to the project root, and plain `dotenv/config` only ever looks
// in cwd. Same class of bug as the "@/" import aliases: anything resolved
// relative to cwd is fragile once something other than a person in this
// directory launches the script.
//
// `quiet: true` matters here more than it would anywhere else: stdio
// transport requires stdout to carry ONLY JSON-RPC messages. dotenv's
// default "◇ injected env" banner prints to stdout, which Claude Desktop's
// parser then chokes on as invalid JSON before the real protocol messages
// ever get a chance to flow.
dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

/**
 * Local MCP server for Claude Desktop — stdio transport.
 *
 * Run with `npm run mcp` (or `npx tsx mcp-server.ts` directly) and point
 * Claude Desktop's config at this command. This path talks to the database
 * directly, using whatever DATABASE_URL is in your local `.env` — the same
 * trust model as running any other script in this repo locally. There is no
 * per-request auth here because there is no remote caller to authenticate:
 * stdio only exists between this process and the Claude Desktop instance that
 * spawned it on the same machine.
 *
 * The remote path (src/app/api/mcp/route.ts) is the one that needs OAuth,
 * rate limiting, and an access log — this file intentionally has none of that.
 *
 * The one thing this file DOES still respect is the admin's on/off switch:
 * if MCP has been disabled from the settings page, this refuses to start
 * rather than quietly serving data the admin turned off.
 */

async function main() {
  const settings = await getMcpSettings();
  if (!settings.enabled) {
    console.error(
      "MCP is disabled in Transformer DNA's admin settings (/mcp). " +
        "An admin needs to turn it back on before this server will run.",
    );
    process.exit(1);
  }

  const server = new McpServer({ name: "transformer-pulse", version: "1.0.0" });

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        // Every tool's inputSchema is a z.object(...) — .shape is the raw
        // field map registerTool expects. See tools.ts for why this isn't
        // derived from the jsonSchema field instead (same reasoning, reversed:
        // that field is hand-written for the HTTP route's tools/list response
        // and isn't a Zod schema at all).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: (tool.inputSchema as any).shape ?? {},
      },
      async (args: unknown) => {
        const result = await tool.handler(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Transformer DNA MCP server running on stdio — ${MCP_TOOLS.length} tools registered.`);
}

main().catch((error) => {
  console.error("MCP server failed to start:", error);
  process.exit(1);
});
