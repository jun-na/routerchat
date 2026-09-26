"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    Check,
    HardDrive,
    Image as ImageIcon,
    Info,
    Loader2,
    Trash2,
} from "lucide-react";
import { useSync } from "@/contexts/SyncContext";
import {
    cleanupOldAttachments,
    getImageStorageUsage,
    getStorageUsage,
} from "@/lib/db";
import { LOCAL_IMAGE_QUOTA } from "@shared/core/quota";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function SettingsLocalData() {
    const {
        cloudQuotaStatus,
        cloudStorageUsage,
        clearCloudImages,
        isConvexAvailable,
        isCloudflareAvailable,
        localQuotaStatus,
        refreshQuotaStatus,
    } = useSync();

    const [storageUsage, setStorageUsage] = useState<{
        attachments: number;
        messages: number;
        sessions: number;
    } | null>(null);
    const [loadingStorage, setLoadingStorage] = useState(true);
    const [clearingStorage, setClearingStorage] = useState(false);
    const [clearingCloudStorage, setClearingCloudStorage] = useState(false);
    const previousLocalUsageRef = useRef<number | null>(null);

    const loadStorageUsage = useCallback(async () => {
        try {
            const [usage, imageBytes] = await Promise.all([
                getStorageUsage(),
                getImageStorageUsage(),
            ]);
            setStorageUsage({ ...usage, attachments: imageBytes });
        } catch (error) {
            console.error("Failed to load storage usage:", error);
        } finally {
            setLoadingStorage(false);
        }
    }, []);

    useEffect(() => {
        loadStorageUsage();
    }, [loadStorageUsage]);

    useEffect(() => {
        const previousUsage = previousLocalUsageRef.current;
        previousLocalUsageRef.current = localQuotaStatus.used;
        if (previousUsage !== null && previousUsage !== localQuotaStatus.used) {
            loadStorageUsage();
        }
    }, [localQuotaStatus.used, loadStorageUsage]);

    const handleClearAttachments = async () => {
        if (
            !confirm(
                "This will remove all images from your local conversations. You'll see placeholders where images used to be. This cannot be undone. Continue?",
            )
        ) {
            return;
        }

        setClearingStorage(true);
        try {
            await cleanupOldAttachments(0);
            await loadStorageUsage();
        } catch (error) {
            console.error("Failed to clear attachments:", error);
        } finally {
            setClearingStorage(false);
        }
    };

    const handleClearCloudImages = async () => {
        if (
            !confirm(
                "This will remove all images from your cloud conversations. You'll see placeholders where images used to be. This cannot be undone. Continue?",
            )
        ) {
            return;
        }

        setClearingCloudStorage(true);
        try {
            await clearCloudImages();
            await refreshQuotaStatus();
        } catch (error) {
            console.error("Failed to clear cloud attachments:", error);
        } finally {
            setClearingCloudStorage(false);
        }
    };

    return (
        <section className="card-deco mb-6">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
                    <HardDrive size={16} className="text-primary" />
                </div>
                <h2 className="text-lg font-medium">Image Storage</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
                Manage storage used by image attachments in your conversations.
            </p>

            {loadingStorage ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-sm">Loading storage info...</span>
                </div>
            ) : storageUsage ? (
                <div className="space-y-4">
                    {/* Local storage bar */}
                    <div>
                        <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-muted-foreground">
                                Local Image Storage
                            </span>
                            <span className="font-medium">
                                {formatBytes(storageUsage.attachments)} /{" "}
                                {formatBytes(LOCAL_IMAGE_QUOTA)}
                            </span>
                        </div>
                        <div className="h-2 bg-muted border border-border overflow-hidden">
                            <div
                                className={cn(
                                    "h-full transition-all duration-300",
                                    storageUsage.attachments /
                                        LOCAL_IMAGE_QUOTA >
                                        0.9
                                        ? "bg-error"
                                        : storageUsage.attachments /
                                                LOCAL_IMAGE_QUOTA >
                                            0.7
                                          ? "bg-warning"
                                          : "bg-primary",
                                )}
                                style={{
                                    width: `${Math.min(100, (storageUsage.attachments / LOCAL_IMAGE_QUOTA) * 100)}%`,
                                }}
                            />
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-muted/30 border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <ImageIcon size={14} />
                                <span className="text-xs">Images</span>
                            </div>
                            <span className="text-lg font-medium">
                                {formatBytes(storageUsage.attachments)}
                            </span>
                        </div>
                        <div className="p-3 bg-muted/30 border border-border">
                            <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                <Info size={14} />
                                <span className="text-xs">Conversations</span>
                            </div>
                            <span className="text-lg font-medium">
                                {storageUsage.sessions}
                            </span>
                        </div>
                    </div>

                    {/* Clear button */}
                    {storageUsage.attachments > 0 && (
                        <button
                            onClick={handleClearAttachments}
                            disabled={clearingStorage}
                            className="flex items-center gap-2 px-4 py-2 text-error border border-error/30 hover:bg-error/10 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {clearingStorage ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : (
                                <Trash2 size={14} />
                            )}
                            <span>
                                {clearingStorage
                                    ? "Clearing..."
                                    : "Clear All Local Images"}
                            </span>
                        </button>
                    )}

                    {storageUsage.attachments === 0 && (
                        <div className="flex items-center gap-2 text-muted-foreground/70 text-sm">
                            <Check size={14} />
                            <span>No images stored</span>
                        </div>
                    )}

                    {(isConvexAvailable || isCloudflareAvailable) &&
                        cloudQuotaStatus &&
                        cloudStorageUsage && (
                            <div className="space-y-4 border-t border-border/60 pt-4">
                                <div>
                                    <div className="flex items-center justify-between text-sm mb-2">
                                        <span className="text-muted-foreground">
                                            Cloud Image Storage
                                        </span>
                                        <span className="font-medium">
                                            {formatBytes(cloudQuotaStatus.used)}{" "}
                                            /{" "}
                                            {formatBytes(
                                                cloudQuotaStatus.limit,
                                            )}
                                        </span>
                                    </div>
                                    <div className="h-2 bg-muted border border-border overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full transition-all duration-300",
                                                cloudQuotaStatus.used /
                                                    cloudQuotaStatus.limit >
                                                    0.9
                                                    ? "bg-error"
                                                    : cloudQuotaStatus.used /
                                                            cloudQuotaStatus.limit >
                                                        0.7
                                                      ? "bg-warning"
                                                      : "bg-primary",
                                            )}
                                            style={{
                                                width: `${Math.min(100, (cloudQuotaStatus.used / cloudQuotaStatus.limit) * 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 bg-muted/30 border border-border">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                            <ImageIcon size={14} />
                                            <span className="text-xs">
                                                Cloud Images
                                            </span>
                                        </div>
                                        <span className="text-lg font-medium">
                                            {formatBytes(
                                                cloudStorageUsage.bytes,
                                            )}
                                        </span>
                                    </div>
                                    <div className="p-3 bg-muted/30 border border-border">
                                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                                            <Info size={14} />
                                            <span className="text-xs">
                                                Cloud Conversations
                                            </span>
                                        </div>
                                        <span className="text-lg font-medium">
                                            {cloudStorageUsage.sessionCount}
                                        </span>
                                    </div>
                                </div>

                                {cloudStorageUsage.bytes > 0 && (
                                    <button
                                        onClick={handleClearCloudImages}
                                        disabled={clearingCloudStorage}
                                        className="flex items-center gap-2 px-4 py-2 text-error border border-error/30 hover:bg-error/10 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                        {clearingCloudStorage ? (
                                            <Loader2
                                                size={14}
                                                className="animate-spin"
                                            />
                                        ) : (
                                            <Trash2 size={14} />
                                        )}
                                        <span>
                                            {clearingCloudStorage
                                                ? "Clearing..."
                                                : "Clear All Cloud Images"}
                                        </span>
                                    </button>
                                )}

                                {cloudStorageUsage.bytes === 0 && (
                                    <div className="flex items-center gap-2 text-muted-foreground/70 text-sm">
                                        <Check size={14} />
                                        <span>No cloud images stored</span>
                                    </div>
                                )}
                            </div>
                        )}
                </div>
            ) : (
                <div className="text-sm text-muted-foreground">
                    Unable to load storage information
                </div>
            )}
        </section>
    );
}
