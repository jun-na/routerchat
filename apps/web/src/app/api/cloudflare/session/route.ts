import { authenticateCloudflareAccess } from "@/lib/cloudflare/access";
import { getCloudflareBindings } from "@/lib/cloudflare/runtime";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const bindings = await getCloudflareBindings();
    if (
        !bindings.DB ||
        !bindings.CLOUDFLARE_ACCESS_TEAM_DOMAIN ||
        !bindings.CLOUDFLARE_ACCESS_AUD
    ) {
        return Response.json(
            { error: "Cloudflare sync is not configured" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
        );
    }

    const identity = await authenticateCloudflareAccess(request, bindings);
    if (!identity) {
        return Response.json(
            { error: "Cloudflare Access authentication required" },
            { status: 401, headers: { "Cache-Control": "no-store" } },
        );
    }

    return Response.json(
        { identity },
        { headers: { "Cache-Control": "no-store" } },
    );
}
