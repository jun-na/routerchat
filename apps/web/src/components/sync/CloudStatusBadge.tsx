"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import { cn } from "@/lib/utils";

/**
 * Cloud Status Badge
 *
 * Shows the current cloud sync status in the sidebar.
 * Hidden when Convex is not configured (local-only mode).
 */
export function CloudStatusBadge() {
    const {
        syncState,
        isConvexAvailable,
        isCloudflareAvailable,
        isMigrating,
        isCloning,
    } = useSync();

    if (!isConvexAvailable && !isCloudflareAvailable) {
        return null;
    }

    const isLoading = isMigrating || isCloning;

    // Determine badge appearance based on state
    const getBadgeConfig = () => {
        if (isLoading) {
            return {
                icon: <Loader2 size={12} className="animate-spin" />,
                label: isMigrating ? "Syncing..." : "Cloning...",
                className: "text-primary bg-primary/10",
            };
        }

        switch (syncState) {
            case "cloud-enabled":
                return {
                    icon: <Cloud size={12} />,
                    label: "Cloud Sync",
                    className: "text-success bg-success/10",
                };
            case "cloud-disabled":
                return {
                    icon: <CloudOff size={12} />,
                    label: "Sync Off",
                    className: "text-muted-foreground bg-muted",
                };
            case "local-only":
            default:
                return {
                    icon: <CloudOff size={12} />,
                    label: "Local Only",
                    className: "text-muted-foreground bg-muted/50",
                };
        }
    };

    const config = getBadgeConfig();

    return (
        <div
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                config.className,
            )}
        >
            {config.icon}
            <span>{config.label}</span>
        </div>
    );
}
