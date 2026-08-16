import type { Role } from "@/generated/prisma/enums";

/**
 * Navigation, grouped.
 *
 * The old nav was one flat row of links per role. A manager had twelve. Twelve
 * links laid out horizontally do not fit next to a name, a role, an alert bell,
 * an avatar and a sign-out button — so on a laptop they ran underneath the user
 * block and the two collided. That is the overlapping text in the header.
 *
 * Widening the breakpoint would have hidden the symptom until somebody with a
 * longer name logged in. The actual problem is that a flat list has no idea
 * which of its items matter, so it competes for the same horizontal space as
 * everything else in the header. Grouping fixes it structurally: the links move
 * to a vertical rail on desktop, where a thirteenth link costs nothing, and
 * into a drawer on a phone.
 *
 * Sections are ordered by how often somebody opens them, not alphabetically.
 * The thing a regional manager does every morning is check what is waiting for
 * approval, so that section is first.
 */

export type NavLink = { href: string; label: string };
export type NavSection = { title: string; links: NavLink[] };

const MANAGER_CORE: NavSection[] = [
  {
    title: "Dashboard",
    links: [
      { href: "/manager/dashboard", label: "Overview" },
      { href: "/manager/priority", label: "Priority list" },
    ],
  },
  {
    title: "Approvals",
    links: [
      { href: "/manager/approvals/actions", label: "Action approvals" },
      { href: "/manager/approvals", label: "Stock approvals" },
      { href: "/manager/batch-approvals", label: "Batch approvals" },
      { href: "/manager/transactions", label: "Movements" },
      { href: "/store/transfer", label: "Raise a movement" },
    ],
  },
  {
    title: "Assets",
    links: [
      { href: "/transformers", label: "All transformers" },
      { href: "/manager/map", label: "Map" },
      { href: "/manager/search", label: "Search" },
    ],
  },
  {
    title: "Monitoring",
    links: [
      { href: "/manager/untested", label: "Untested in field" },
      { href: "/manager/warranty", label: "Warranty claims" },
      { href: "/admin/field-engineers", label: "Field engineers" },
    ],
  },
  // These screens existed and were reachable only by typing the URL — the flat
  // header row had no space left, so they were built and then hidden. A rail
  // has space, so they are listed.
  {
    title: "Data",
    links: [
      { href: "/manager/meter-data", label: "Meter data" },
      { href: "/manager/emdis", label: "EMDis import" },
      { href: "/manager/staging", label: "Staged records" },
    ],
  },
  {
    title: "Reports",
    links: [
      { href: "/manager/reports", label: "Reports" },
      { href: "/mcp", label: "MCP access" },
    ],
  },
];

/**
 * A store manager sees the manager sections with the region-wide entries taken
 * out. Everything left already scopes itself to their own store — see
 * `visibleTransformerWhere` in region-scope.ts, which fails closed rather than
 * falling back to a region.
 */
const STORE_MANAGER_SECTIONS: NavSection[] = [
  {
    title: "Dashboard",
    links: [{ href: "/manager/dashboard", label: "Overview" }],
  },
  {
    title: "Approvals",
    links: [
      { href: "/manager/approvals/actions", label: "Action approvals" },
      { href: "/manager/approvals", label: "Stock approvals" },
      { href: "/manager/batch-approvals", label: "Batch approvals" },
      { href: "/manager/transactions", label: "Movements" },
    ],
  },
  {
    title: "Assets",
    links: [{ href: "/transformers", label: "All transformers" }],
  },
  {
    title: "Monitoring",
    links: [{ href: "/manager/untested", label: "Untested in field" }],
  },
];

export const NAV_SECTIONS: Record<Role, NavSection[]> = {
  ADMIN: [
    {
      title: "Dashboard",
      links: [
        { href: "/admin/dashboard", label: "Overview" },
        { href: "/manager/approvals/actions", label: "Action approvals" },
        { href: "/manager/approvals", label: "Stock approvals" },
      ],
    },
    {
      title: "Assets",
      links: [
        { href: "/transformers", label: "All transformers" },
        { href: "/manager/map", label: "Map" },
        { href: "/admin/qr-codes", label: "QR labels" },
      ],
    },
    {
      title: "People and places",
      links: [
        { href: "/admin/users", label: "Users" },
        { href: "/admin/field-engineers", label: "Field engineers" },
        { href: "/admin/stores", label: "Stores" },
        { href: "/admin/manufacturers", label: "Manufacturers" },
      ],
    },
    {
      title: "Integrity",
      links: [
        { href: "/admin/audit", label: "Audit log" },
        { href: "/admin/chain", label: "Chain verification" },
      ],
    },
    {
      title: "Settings",
      links: [
        { href: "/admin/settings", label: "System settings" },
        { href: "/admin/load-formats", label: "Load formats" },
        { href: "/mcp", label: "MCP access" },
      ],
    },
  ],
  MANAGER: MANAGER_CORE,
  STORE_MANAGER: STORE_MANAGER_SECTIONS,
  STORE_KEEPER: [
    {
      title: "Dashboard",
      links: [{ href: "/store/dashboard", label: "My store" }],
    },
    {
      title: "Receiving",
      links: [
        { href: "/store/receive", label: "Receive one unit" },
        { href: "/store/receive-batch", label: "Receive a batch" },
        { href: "/store/import", label: "Import a spreadsheet" },
      ],
    },
    // No "movement history" link here. /manager/transactions refuses
    // STORE_KEEPER at requireRole, so listing it would offer a keeper a door
    // that shuts in their face — the exact complaint that produced this file.
    {
      title: "Movements",
      links: [
        { href: "/store/transfer", label: "Move stock" },
        { href: "/store/workshop", label: "Workshop" },
      ],
    },
    {
      title: "Assets",
      links: [
        { href: "/transformers", label: "All transformers" },
        { href: "/mcp", label: "MCP access" },
      ],
    },
  ],
  FIELD_ENGINEER: [
    {
      title: "My work",
      links: [
        { href: "/field/dashboard", label: "Assigned to me" },
        { href: "/field/scan", label: "Submit a reading" },
        { href: "/field/onboard", label: "Onboard a unit" },
        { href: "/field/recover", label: "Recover a unit" },
      ],
    },
    {
      title: "Assets",
      links: [
        { href: "/field/map", label: "Map" },
        { href: "/field/qr-scan", label: "Scan a tag" },
        { href: "/transformers", label: "All transformers" },
      ],
    },
  ],
};

/** The two or three links that go in the header on a narrow laptop. */
export const QUICK_LINKS: Record<Role, NavLink[]> = {
  ADMIN: [
    { href: "/admin/dashboard", label: "Overview" },
    { href: "/manager/approvals", label: "Approvals" },
  ],
  MANAGER: [
    { href: "/manager/dashboard", label: "Dashboard" },
    { href: "/manager/approvals", label: "Approvals" },
    { href: "/manager/map", label: "Map" },
  ],
  STORE_MANAGER: [
    { href: "/manager/dashboard", label: "Dashboard" },
    { href: "/manager/approvals", label: "Approvals" },
  ],
  STORE_KEEPER: [
    { href: "/store/dashboard", label: "Store" },
    { href: "/store/receive-batch", label: "Receive" },
  ],
  FIELD_ENGINEER: [{ href: "/field/dashboard", label: "My work" }],
};
