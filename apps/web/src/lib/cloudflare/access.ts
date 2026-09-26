import { createRemoteJWKSet, jwtVerify } from "jose";
import type { CloudflareBindings } from "./bindings";

export interface CloudflareIdentity {
    userId: string;
    email: string;
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string) {
    let jwks = jwksByIssuer.get(issuer);
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
        jwksByIssuer.set(issuer, jwks);
    }
    return jwks;
}

function toHex(bytes: ArrayBuffer): string {
    return Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

export async function authenticateCloudflareAccess(
    request: Request,
    bindings: CloudflareBindings,
): Promise<CloudflareIdentity | null> {
    const teamDomain = bindings.CLOUDFLARE_ACCESS_TEAM_DOMAIN?.trim();
    const audience = bindings.CLOUDFLARE_ACCESS_AUD?.trim();
    const token = request.headers.get("cf-access-jwt-assertion");

    if (!teamDomain || !audience || !token) return null;

    let issuer: string;
    try {
        const url = new URL(teamDomain);
        if (url.protocol !== "https:") return null;
        issuer = url.origin;
    } catch {
        return null;
    }

    try {
        const { payload } = await jwtVerify(token, getJwks(issuer), {
            issuer,
            audience,
        });

        const email =
            typeof payload.email === "string" ? payload.email.trim() : "";
        const subject =
            typeof payload.sub === "string" ? payload.sub.trim() : email;
        if (!email || !subject || !email.includes("@")) return null;

        const identityHash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(`${issuer}:${subject}`),
        );

        return {
            userId: toHex(identityHash),
            email: email.toLowerCase(),
        };
    } catch {
        return null;
    }
}
