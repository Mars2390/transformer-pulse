import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * GET /api/mcp/docs — serves MCP.md straight from the repo root.
 *
 * Reads the file at request time instead of duplicating its content into
 * `public/`, so the docs linked from the status page and settings page can
 * never drift out of sync with the actual MCP.md a developer edits.
 */
export async function GET(request: Request) {
  let markdown: string;
  try {
    markdown = await readFile(path.join(process.cwd(), "MCP.md"), "utf8");
  } catch {
    return NextResponse.json({ error: "MCP.md not found on this deployment." }, { status: 404 });
  }

  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return new NextResponse(markdown, { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  }

  const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transformer Pulse — MCP documentation</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f5f6f8;margin:0;padding:0;color:#1c1f1f}
  .card{max-width:760px;margin:32px auto;background:#fff;border:1px solid #e3e6ec;border-radius:16px;padding:32px 40px}
  pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.6}
</style></head><body><div class="card"><pre>${escaped}</pre></div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
