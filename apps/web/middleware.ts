import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Only enforce security headers on deployed environments (preview/prod), not
// local development (`next dev`).
const isProduction = process.env.NODE_ENV === "production";
const canonicalHost = process.env.CANONICAL_HOST?.trim().toLowerCase();

function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

function getRequestHost(request: NextRequest): string {
    const forwardedHost =
        request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
    if (forwardedHost) {
        return normalizeHost(forwardedHost);
    }

    const hostHeader = request.headers.get("host")?.trim() ?? "";
    if (hostHeader) {
        return normalizeHost(hostHeader);
    }

    return normalizeHost(request.nextUrl.host);
}

function createNonce(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    // base64 nonce value for CSP
    return btoa(binary);
}

function applyCommonSecurityHeaders(response: NextResponse): void {
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Frame-Options", "DENY");

    // Prevent this origin from being persisted in a less-isolated agent cluster.
    response.headers.set("Origin-Agent-Cluster", "?1");

    // Disable legacy/buggy XSS auditor behavior.
    response.headers.set("X-XSS-Protection", "0");

    // Lock down powerful features in embedded contexts; keep top-level behavior.
    response.headers.set(
        "Permissions-Policy",
        "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );

    // HSTS is only respected by browsers over HTTPS, which is what we use in
    // preview/prod. It is ignored over HTTP.
    response.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
    );
}

export function middleware(request: NextRequest) {
    if (!isProduction) {
        return NextResponse.next();
    }

    if (canonicalHost) {
        const requestHost = getRequestHost(request);
        if (requestHost && requestHost !== canonicalHost) {
            const redirectUrl = request.nextUrl.clone();
            redirectUrl.protocol = "https";
            redirectUrl.hostname = canonicalHost;
            redirectUrl.port = "";

            const response = NextResponse.redirect(redirectUrl, 308);
            applyCommonSecurityHeaders(response);
            return response;
        }
    }

    const disableCsp = process.env.DISABLE_CSP?.toLowerCase() === "true";

    let cspValue: string | null = null;
    const requestHeaders = new Headers(request.headers);

    if (!disableCsp) {
        const nonce = createNonce();

        const scriptSrc = ["'self'", `'nonce-${nonce}'`].join(" ");

        const csp: string[] = [
            "default-src 'self'",
            `script-src ${scriptSrc}`,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' https: wss:",
            "base-uri 'none'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "worker-src 'self' blob:",
            "manifest-src 'self'",
            "upgrade-insecure-requests",
        ];

        cspValue = csp.join("; ");

        // Next.js App Router can automatically nonce its own inline scripts if it can
        // extract a nonce from the *request* CSP header. So we set CSP on both the
        // request (for Next) and response (for the browser).
        requestHeaders.set("content-security-policy", cspValue);
    }

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });

    applyCommonSecurityHeaders(response);

    if (cspValue) {
        response.headers.set("Content-Security-Policy", cspValue);
    }

    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
