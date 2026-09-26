import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
    define: {
        "process.env.NEXT_PUBLIC_CLOUDFLARE_SYNC_ENABLED": JSON.stringify(true),
    },
    plugins: [
        vinext(),
        cloudflare({
            viteEnvironment: {
                name: "rsc",
                childEnvironments: ["ssr"],
            },
        }),
    ],
});
