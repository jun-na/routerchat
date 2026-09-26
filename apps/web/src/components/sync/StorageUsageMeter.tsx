"use client";

import { useSync } from "@/contexts/SyncContext";
import { formatBytes } from "@shared/core/quota";
import { cn } from "@/lib/utils";
import type { QuotaStatus } from "@/lib/sync/types";

/**
 * Storage Usage Meter
 *
 * Visual progress bar showing storage usage with warning states.
 */
interface StorageUsageMeterProps {
    variant: "local" | "cloud";
    className?: string;
}

export function getStorageUsageBarClass(status: QuotaStatus): string {
    if (status.isExceeded) return "bg-error";
    if (status.isWarning95) return "bg-error";
    if (status.isWarning80) return "bg-warning";
    return "bg-primary";
}

export function getStorageUsageWarning(status: QuotaStatus): string | null {
    if (status.isWarning95) {
        return "Storage almost full. You may not be able to add more images soon. Consider deleting old conversations or clearing images.";
    }
    if (status.isWarning80) {
        return "Storage usage is high. Consider removing old conversations.";
    }
    return null;
}

export function getStorageUsagePercent(status: QuotaStatus): number {
    return Math.min(100, status.percentage * 100);
}

export function StorageUsageMeter({
    variant,
    className,
}: StorageUsageMeterProps) {
    const {
        localQuotaStatus,
        cloudQuotaStatus,
        syncState,
        isConvexAvailable,
        isCloudflareAvailable,
    } = useSync();

    // Hide cloud meter if not in cloud-enabled state or Convex not available
    if (
        variant === "cloud" &&
        ((!isConvexAvailable && !isCloudflareAvailable) ||
            syncState !== "cloud-enabled")
    ) {
        return null;
    }

    const quotaStatus =
        variant === "local" ? localQuotaStatus : cloudQuotaStatus;

    if (!quotaStatus) {
        return null;
    }

    const { used, limit, isWarning80, isWarning95 } = quotaStatus;

    const barClass = getStorageUsageBarClass(quotaStatus);
    const warningMessage = getStorageUsageWarning(quotaStatus);

    const label = variant === "local" ? "Local Storage" : "Cloud Storage";

    return (
        <div className={cn("space-y-1", className)}>
            <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label}</span>
                <span
                    className={cn(
                        "font-medium",
                        isWarning95 && "text-error",
                        isWarning80 && !isWarning95 && "text-warning",
                    )}
                >
                    {formatBytes(used)} / {formatBytes(limit)}
                </span>
            </div>
            <div className="h-2 bg-muted border border-border overflow-hidden">
                <div
                    className={cn(
                        "h-full transition-all duration-300",
                        barClass,
                    )}
                    style={{ width: `${getStorageUsagePercent(quotaStatus)}%` }}
                />
            </div>
            {warningMessage && (
                <p
                    className={cn(
                        "text-xs",
                        isWarning95 ? "text-error" : "text-warning",
                    )}
                >
                    {warningMessage}
                </p>
            )}
        </div>
    );
}
