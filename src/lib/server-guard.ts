/**
 * Same protection as the "server-only" package, minus the part that breaks
 * outside Next.js.
 *
 * That package's `index.js` throws unconditionally; it only resolves to its
 * no-op sibling when a bundler sets webpack's "react-server" condition,
 * which is something Next.js's own build does and plain Node (tsx, ts-node,
 * a script run directly) never does. That made every file which imported it
 * transitively unusable from mcp-server.ts, which runs as a standalone
 * script, not through Next's bundler.
 *
 * This checks the one thing that actually matters — did this code end up in
 * a browser bundle — instead of which bundler condition resolved the import.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "This module cannot be imported from a Client Component module. It should only be used from a Server Component.",
  );
}
