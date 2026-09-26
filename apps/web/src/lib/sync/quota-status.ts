"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { ConvexClient } from "@/lib/sync/convex-adapter";
import type { StorageAdapter } from "@/lib/sync/storage-adapter";
import { clearCloudAttachmentCaches } from "@/lib/sync/convex-adapter";
import { clearCloudImagesAndRefresh } from "@/lib/sync/clear-cloud-images";
import { getCloudQuotaStatus } from "@/lib/sync/quota";
import { getLocalStorageAdapter } from "@/lib/sync/local-adapter";
import type { QuotaStatus } from "@/lib/sync/types";
import {
    LOCAL_IMAGE_QUOTA,
    QUOTA_WARNING_80,
    QUOTA_WARNING_95,
} from "@shared/core/quota";

export function useQuotaStatus(params: {
    cloudAdapter: StorageAdapter | null;
    convexClient?: ConvexClient | null;
    isAuthenticated: boolean;
    onCloudImagesCleared?: () => void;
}) {
    const {
        cloudAdapter,
        convexClient,
        isAuthenticated,
        onCloudImagesCleared,
    } = params;
    const hasEnsuredUsageCountersRef = useRef(false);
    const [localQuotaStatus, setLocalQuotaStatus] = useState<QuotaStatus>({
        used: 0,
        limit: LOCAL_IMAGE_QUOTA,
        percentage: 0,
        isWarning80: false,
        isWarning95: false,
        isExceeded: false,
    });
    const [cloudQuotaStatus, setCloudQuotaStatus] =
        useState<QuotaStatus | null>(null);
    const [cloudStorageUsage, setCloudStorageUsage] = useState<{
        bytes: number;
        messageCount: number;
        sessionCount: number;
    } | null>(null);

    useEffect(() => {
        if (!convexClient || !cloudAdapter || !isAuthenticated) {
            hasEnsuredUsageCountersRef.current = false;
            return;
        }

        if (hasEnsuredUsageCountersRef.current) return;
        hasEnsuredUsageCountersRef.current = true;

        void convexClient
            .mutation(api.users.ensureUsageCounters, {})
            .catch((error) => {
                hasEnsuredUsageCountersRef.current = false;
                console.error("Failed to ensure cloud usage counters:", error);
            });
    }, [cloudAdapter, convexClient, isAuthenticated]);

    const refreshLocalQuotaStatus = useCallback(async () => {
        try {
            const adapter = getLocalStorageAdapter();
            const used = await adapter.getImageStorageUsage();
            const percentage = used / LOCAL_IMAGE_QUOTA;

            setLocalQuotaStatus({
                used,
                limit: LOCAL_IMAGE_QUOTA,
                percentage,
                isWarning80: percentage >= QUOTA_WARNING_80,
                isWarning95: percentage >= QUOTA_WARNING_95,
                isExceeded: percentage >= 1,
            });
        } catch (error) {
            console.error("Failed to refresh local quota status:", error);
        }
    }, []);

    const refreshCloudQuotaStatus = useCallback(async () => {
        if (!cloudAdapter || !isAuthenticated) {
            setCloudQuotaStatus(null);
            return;
        }

        try {
            setCloudQuotaStatus(await getCloudQuotaStatus(cloudAdapter));
        } catch (error) {
            console.error("Failed to refresh cloud quota status:", error);
        }
    }, [cloudAdapter, isAuthenticated]);

    const refreshCloudStorageUsage = useCallback(async () => {
        if (!cloudAdapter || !isAuthenticated) {
            setCloudStorageUsage(null);
            return;
        }

        try {
            setCloudStorageUsage(await cloudAdapter.getStorageUsage());
        } catch (error) {
            console.error("Failed to refresh cloud storage usage:", error);
        }
    }, [cloudAdapter, isAuthenticated]);

    const refreshQuotaStatus = useCallback(async () => {
        await Promise.all([
            refreshLocalQuotaStatus(),
            refreshCloudQuotaStatus(),
            refreshCloudStorageUsage(),
        ]);
    }, [
        refreshLocalQuotaStatus,
        refreshCloudQuotaStatus,
        refreshCloudStorageUsage,
    ]);

    const clearCloudImages = useCallback(async () => {
        if (cloudAdapter?.clearCloudImages) {
            await cloudAdapter.clearCloudImages();
            onCloudImagesCleared?.();
            await refreshQuotaStatus();
            return;
        }

        await clearCloudImagesAndRefresh({
            convexClient,
            clearAttachmentCaches: clearCloudAttachmentCaches,
            onCloudImagesCleared,
            refreshQuotaStatus,
        });
    }, [cloudAdapter, convexClient, onCloudImagesCleared, refreshQuotaStatus]);

    useEffect(() => {
        queueMicrotask(() => {
            void refreshQuotaStatus();
        });
    }, [refreshQuotaStatus]);

    return {
        localQuotaStatus,
        cloudQuotaStatus,
        cloudStorageUsage,
        refreshQuotaStatus,
        clearCloudImages,
    };
}
