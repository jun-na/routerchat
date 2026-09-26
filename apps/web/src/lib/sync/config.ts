/**
 * Convex Configuration Detection
 *
 * Runtime detection of Convex availability for graceful degradation.
 * When Convex is not configured, the app operates in local-only mode.
 */

/**
 * Check if Convex is configured at runtime.
 * Returns null on server-side, or the actual config status on client.
 */
export function isConvexConfigured(): boolean | null {
    // Server-side: return null to indicate "unknown"
    if (typeof window === "undefined") {
        return null;
    }

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

    // Check for valid URL (not empty, not placeholder)
    if (!convexUrl || convexUrl.trim() === "") {
        return false;
    }

    // Basic URL validation - should start with https://
    if (!convexUrl.startsWith("https://")) {
        return false;
    }

    return true;
}

/**
 * Get the Convex URL if configured.
 * Returns null on server-side or when not configured.
 */
export function getConvexUrl(): string | null {
    const configured = isConvexConfigured();
    if (configured === null || configured === false) {
        return null;
    }

    return process.env.NEXT_PUBLIC_CONVEX_URL || null;
}

/**
 * Check if we're running on the server.
 */
export function isServer(): boolean {
    return typeof window === "undefined";
}

/** True in the Cloudflare Workers build, injected by `vite.config.ts`. */
export function isCloudflareSyncEnabled(): boolean {
    return process.env.NEXT_PUBLIC_CLOUDFLARE_SYNC_ENABLED === "true";
}
