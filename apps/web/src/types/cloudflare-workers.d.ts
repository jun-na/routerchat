declare module "cloudflare:workers" {
    export const env: import("@/lib/cloudflare/bindings").CloudflareBindings;
}
