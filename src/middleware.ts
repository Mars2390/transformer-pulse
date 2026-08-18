import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  canEnter,
  roleHome,
  verifySessionToken,
} from "@/lib/session";

/**
 * The gate.
 *
 * Runs on every matched request, in the Edge runtime, before the page does any
 * work. It verifies the cookie's signature and nothing else — no database, no
 * Prisma. That is a hard constraint of the Edge runtime, and also the right
 * design: a signature check is microseconds; a database round trip on every
 * request is not.
 *
 * IMPORTANT: this is a redirect layer, not the security boundary. A cookie is
 * client-controlled, so every page and API route ALSO checks the session
 * server-side via requireRole(). Middleware makes the app behave correctly;
 * requireRole() makes it safe. Never rely on this file alone.
 */

const PROTECTED = ["/admin", "/manager", "/store", "/field", "/transformers", "/dashboard", "/kplc-control", "/mcp"];

function isProtected(pathname: string): boolean {
  return PROTECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Publishes the method and the path as request headers.
 *
 * headers() inside a route hands back the REQUEST headers, so anything a route
 * needs to know about the request that is not already a header has to be put
 * there by the only code that runs first. The perimeter in requireApiUser()
 * needs the method to decide whether the Origin rule applies, and the path to
 * log which route was throttled.
 *
 * Both are always overwritten, never merged, so a client cannot pre-set them.
 * Every NextResponse.next() in this file goes through here — including the
 * fail-safe in the catch — because a request that arrives unannotated is one
 * whose Origin the perimeter would not check.
 */
function annotate(request: NextRequest, pathname: string) {
  const forward = new Headers(request.headers);
  forward.set("x-http-method", request.method);
  forward.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: forward } });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  try {
    const session = await verifySessionToken(
      request.cookies.get(SESSION_COOKIE)?.value,
    );

    // Already signed in and heading to /login? Send them where they belong.
    if (pathname === "/login" && session) {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    if (!isProtected(pathname)) return annotate(request, pathname);

    // Not signed in — remember where they were going, then send them to login.
    if (!session) {
      const url = new URL("/login", request.url);
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }

    // /dashboard is a signpost, not a page.
    if (pathname === "/dashboard") {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    // Signed in, but this area is not theirs. Send them to their own dashboard
    // rather than a dead end.
    if (!canEnter(session.role, pathname)) {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }

    return annotate(request, pathname);
  } catch (error) {
    // A throw in Edge middleware returns MIDDLEWARE_INVOCATION_FAILED for the
    // WHOLE SITE — the landing page included, which needs no session at all.
    // That is never an acceptable outcome for a bug in an auth hint.
    //
    // So: log it, then fail SAFE rather than open. Protected routes go to the
    // login page; public routes carry on. The layout's requireRole() is still
    // the real boundary, so nothing private can leak through this path.
    console.error("Middleware error:", error);

    if (isProtected(pathname)) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return annotate(request, pathname);
  }
}

export const config = {
  // The API is no longer excluded. Middleware never redirects an API request —
  // isProtected() covers page prefixes only, so an API path falls straight
  // through to annotate() — but it does have to run there, because the method
  // and path headers the perimeter reads can only be set by the layer that runs
  // before the route. Next internals and static files stay out.
  matcher: ["/((?!_next/static|_next/image|images|favicon.ico|.*\\.png$).*)"],
};
