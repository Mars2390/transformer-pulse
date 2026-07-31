/**
 * Never hand a real person's name to a remote MCP client.
 *
 * The tool responses in this module cross a trust boundary the rest of the
 * app doesn't: a signed-in browser session is KPLC staff on KPLC's network,
 * but an MCP bearer token can be replayed from anywhere the holder chooses.
 * "Engineer #a1b2c" costs nothing to an analyst asking "who inspected this
 * transformer last" and costs a real person their privacy if it were their name.
 */
export function maskEngineerName(user: { id: string; name?: string | null } | null | undefined): string {
  if (!user) return "Unknown";
  return `Engineer #${user.id.slice(-5).toUpperCase()}`;
}
