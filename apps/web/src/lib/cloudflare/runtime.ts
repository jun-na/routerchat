import type { CloudflareBindings } from "./bindings";

/**
 * Workers bindings exist only in the Cloudflare runtime. The Next.js alias
 * points this import at an empty development shim during ordinary Node builds.
 */
export async function getCloudflareBindings(): Promise<CloudflareBindings> {
    try {
        // The Cloudflare Vite plugin resolves this runtime-only module.
        const workerRuntime = (await import("cloudflare:workers")) as {
            env?: CloudflareBindings;
        };
        return workerRuntime.env ?? {};
    } catch {
        return {};
    }
}
