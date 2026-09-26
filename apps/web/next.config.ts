import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
    reactStrictMode: true,
    webpack(config, { isServer }) {
        if (isServer) {
            config.resolve.alias["cloudflare:workers"] = path.resolve(
                process.cwd(),
                "src/lib/cloudflare/node-bindings.ts",
            );
        }
        return config;
    },
};

export default nextConfig;
