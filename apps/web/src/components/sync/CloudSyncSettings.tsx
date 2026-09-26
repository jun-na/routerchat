"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Cloud, ChevronRight, Loader2 } from "lucide-react";
import { useSafeConvexAuth } from "@/contexts/ConvexProvider";
import { useSync } from "@/contexts/SyncContext";
import { api } from "@convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { CloneToLocalButton } from "./CloneToLocalButton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import * as storage from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { SyncState } from "@/lib/sync/types";

/**
 * Cloud Sync Settings Section
 *
 * Complete settings section for managing cloud sync.
 * Hidden when Convex is not configured.
 */
interface CloudSyncSettingsProps {
    highlightEnable?: boolean;
}

interface CloudAutoEnableInput {
    isAuthenticated: boolean;
    hasAutoEnableReason: boolean;
    isInitialSyncLoaded: boolean;
    syncState: SyncState;
    isMigrating: boolean;
    isLoading: boolean;
    showEnableConfirm: boolean;
    showDisableConfirm: boolean;
    showSignInConfirm: boolean;
    hasAttempted: boolean;
}

interface CloudAutoEnableDecision {
    shouldResetAttempt: boolean;
    shouldClearReason: boolean;
    shouldEnable: boolean;
}

export function getCloudAutoEnableDecision(
    input: CloudAutoEnableInput,
): CloudAutoEnableDecision {
    if (!input.isAuthenticated) {
        return {
            shouldResetAttempt: true,
            shouldClearReason: false,
            shouldEnable: false,
        };
    }

    if (!input.hasAutoEnableReason) {
        return {
            shouldResetAttempt: false,
            shouldClearReason: false,
            shouldEnable: false,
        };
    }

    if (!input.isInitialSyncLoaded) {
        return {
            shouldResetAttempt: false,
            shouldClearReason: false,
            shouldEnable: false,
        };
    }

    if (input.syncState === "cloud-enabled") {
        return {
            shouldResetAttempt: false,
            shouldClearReason: true,
            shouldEnable: false,
        };
    }

    if (input.hasAttempted || input.isMigrating || input.isLoading) {
        return {
            shouldResetAttempt: false,
            shouldClearReason: false,
            shouldEnable: false,
        };
    }

    if (
        input.showEnableConfirm ||
        input.showDisableConfirm ||
        input.showSignInConfirm
    ) {
        return {
            shouldResetAttempt: false,
            shouldClearReason: false,
            shouldEnable: false,
        };
    }

    return {
        shouldResetAttempt: false,
        shouldClearReason: true,
        shouldEnable: true,
    };
}

export function CloudSyncSettings({ highlightEnable }: CloudSyncSettingsProps) {
    const { isConvexAvailable, isCloudflareAvailable } = useSync();

    if (isCloudflareAvailable) {
        return (
            <CloudflareCloudSyncSettings highlightEnable={highlightEnable} />
        );
    }

    if (!isConvexAvailable) {
        return null;
    }

    return <CloudSyncSettingsContent highlightEnable={highlightEnable} />;
}

function CloudflareCloudSyncSettings({
    highlightEnable,
}: CloudSyncSettingsProps) {
    const {
        syncState,
        cloudflareIdentity,
        enableCloudSync,
        disableCloudSync,
        isMigrating,
        migrationProgress,
    } = useSync();
    const [showEnableConfirm, setShowEnableConfirm] = useState(false);
    const [showDisableConfirm, setShowDisableConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [highlightCta, setHighlightCta] = useState(false);

    useEffect(() => {
        if (!highlightEnable) return;
        const animationFrame = window.requestAnimationFrame(() => {
            setHighlightCta(true);
        });
        const timeout = window.setTimeout(() => setHighlightCta(false), 4000);
        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.clearTimeout(timeout);
        };
    }, [highlightEnable]);

    const handleEnable = async () => {
        setShowEnableConfirm(false);
        setIsLoading(true);
        try {
            await enableCloudSync();
        } catch (error) {
            console.error("Failed to enable Cloudflare sync:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisable = async () => {
        setShowDisableConfirm(false);
        try {
            await disableCloudSync();
        } catch (error) {
            console.error("Failed to disable Cloudflare sync:", error);
        }
    };

    return (
        <section className="card-deco mb-6">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-primary/10 flex items-center justify-center">
                    <Cloud size={16} className="text-primary" />
                </div>
                <h2 className="text-lg font-medium">Cloudflare Storage</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                Store conversations in your Cloudflare D1 database and file
                attachments in R2. Cloudflare Access controls account access.
            </p>

            <div className="flex items-center justify-between text-xs border border-border bg-muted/30 px-4 py-3 rounded-sm mb-4">
                <span className="text-muted-foreground">
                    {cloudflareIdentity?.email ?? "Cloudflare Access"}
                </span>
                <span className="font-medium">
                    {syncState === "cloud-enabled"
                        ? "Cloud Sync Enabled"
                        : syncState === "cloud-disabled"
                          ? "Cloud Sync Disabled"
                          : "Local Only"}
                </span>
            </div>

            {syncState === "cloud-enabled" ? (
                <button
                    type="button"
                    onClick={() => setShowDisableConfirm(true)}
                    className="btn-deco-ghost w-full text-muted-foreground cursor-pointer py-3"
                >
                    Disable Cloud Sync on This Device
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => setShowEnableConfirm(true)}
                    disabled={isLoading || isMigrating}
                    className={cn(
                        "btn-deco-primary w-full flex items-center justify-center gap-2 py-3",
                        highlightCta && "ring-2 ring-primary/50",
                        (isLoading || isMigrating) &&
                            "cursor-not-allowed opacity-70",
                    )}
                >
                    {isLoading || isMigrating ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>
                                {isMigrating
                                    ? `Copying local data... ${migrationProgress ? Math.round(migrationProgress.percentage) : 0}%`
                                    : "Loading..."}
                            </span>
                        </>
                    ) : (
                        <>
                            <Cloud size={16} />
                            <span>Enable Cloud Sync</span>
                        </>
                    )}
                </button>
            )}

            {syncState === "cloud-enabled" && (
                <div className="mt-4">
                    <CloneToLocalButton className="text-muted-foreground" />
                </div>
            )}

            <ConfirmDialog
                open={showEnableConfirm}
                title="Enable Cloudflare Sync"
                description="Local chats, messages, skills, and attachments will be copied to your Cloudflare account. Existing cloud records with matching IDs will be updated."
                confirmLabel="Copy and Enable"
                cancelLabel="Cancel"
                onConfirm={handleEnable}
                onCancel={() => setShowEnableConfirm(false)}
            />
            <ConfirmDialog
                open={showDisableConfirm}
                title="Disable Cloud Sync"
                description="This device will use local storage until sync is enabled again. Data already stored in Cloudflare will remain there."
                confirmLabel="Disable Cloud Sync"
                cancelLabel="Cancel"
                onConfirm={handleDisable}
                onCancel={() => setShowDisableConfirm(false)}
            />
        </section>
    );
}

function CloudSyncSettingsContent({
    highlightEnable,
}: {
    highlightEnable?: boolean;
}) {
    const {
        syncState,
        enableCloudSync,
        disableCloudSync,
        isMigrating,
        migrationProgress,
    } = useSync();
    const { isAuthenticated, isLoading: isAuthLoading } = useSafeConvexAuth();
    const userId = useQuery(
        api.users.getCurrentUserId,
        isAuthenticated ? {} : "skip",
    );
    const user = useQuery(api.users.get, userId ? { id: userId } : "skip");
    const activeDeletes = useQuery(
        api.cleanup.listActive,
        userId ? { userId } : "skip",
    );
    const failedDeletes =
        activeDeletes?.filter((operation) => operation.status === "failed") ??
        [];
    const runningDeletes =
        activeDeletes?.filter((operation) => operation.status !== "failed") ??
        [];
    const isUserIdLoaded = !isAuthenticated || userId !== undefined;
    const isInitialSyncLoaded =
        !isAuthenticated || (isUserIdLoaded && user?.initialSync !== undefined);
    const authActions = useAuthActions();
    const { signIn, signOut } = authActions ?? {};

    const [showEnableConfirm, setShowEnableConfirm] = useState(false);
    const [showDisableConfirm, setShowDisableConfirm] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showSignInConfirm, setShowSignInConfirm] = useState(false);
    const [highlightCta, setHighlightCta] = useState(false);
    const autoEnableRef = useRef(false);

    useEffect(() => {
        if (!highlightEnable) return;
        const animationFrame = window.requestAnimationFrame(() => {
            setHighlightCta(true);
        });
        const timeout = window.setTimeout(() => setHighlightCta(false), 4000);
        return () => {
            window.cancelAnimationFrame(animationFrame);
            window.clearTimeout(timeout);
        };
    }, [highlightEnable]);

    useEffect(() => {
        const autoEnableReason = storage.getSyncAutoEnableReason();
        const decision = getCloudAutoEnableDecision({
            isAuthenticated,
            hasAutoEnableReason: Boolean(autoEnableReason),
            isInitialSyncLoaded,
            syncState,
            isMigrating,
            isLoading,
            showEnableConfirm,
            showDisableConfirm,
            showSignInConfirm,
            hasAttempted: autoEnableRef.current,
        });

        if (decision.shouldResetAttempt) {
            autoEnableRef.current = false;
            return;
        }

        if (!autoEnableReason) return;

        if (decision.shouldClearReason) {
            storage.clearSyncAutoEnableReason();
        }

        if (!decision.shouldEnable) return;

        autoEnableRef.current = true;
        enableCloudSync().catch((error) => {
            console.error("Failed to auto-enable cloud sync:", error);
            autoEnableRef.current = false;
        });
    }, [
        enableCloudSync,
        isAuthenticated,
        isInitialSyncLoaded,
        isLoading,
        isMigrating,
        showDisableConfirm,
        showEnableConfirm,
        showSignInConfirm,
        syncState,
    ]);

    const handleEnableClick = () => {
        if (!isAuthenticated) {
            setShowSignInConfirm(true);
            return;
        }
        setShowEnableConfirm(true);
    };

    const handleAuthAction = async () => {
        if (isAuthLoading) return;
        if (isAuthenticated) {
            try {
                if (syncState === "cloud-enabled") {
                    await disableCloudSync();
                }
            } catch (error) {
                console.error("Failed to disable cloud sync on logout:", error);
            }
            await signOut?.();
            return;
        }
        setShowSignInConfirm(true);
    };

    const handleEnableConfirm = async () => {
        setShowEnableConfirm(false);
        setIsLoading(true);
        try {
            await enableCloudSync();
        } catch (error) {
            console.error("Failed to enable cloud sync:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDisableConfirm = async () => {
        setShowDisableConfirm(false);
        try {
            await disableCloudSync();
        } catch (error) {
            console.error("Failed to disable cloud sync:", error);
        }
    };

    const statusLabel =
        syncState === "cloud-enabled"
            ? "Cloud Sync Enabled"
            : syncState === "cloud-disabled"
              ? "Cloud Sync Disabled"
              : "Local Only";

    const statusTone =
        syncState === "cloud-enabled"
            ? "border-success/30 bg-success/10 text-success"
            : syncState === "cloud-disabled"
              ? "border-warning/30 bg-warning/10 text-warning"
              : "border-border bg-muted/40 text-muted-foreground";

    return (
        <section id="cloud-sync" className="card-deco mb-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 border border-primary/20 bg-primary/10 flex items-center justify-center">
                        <Cloud size={18} className="text-primary" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">Cloud Sync</h2>
                        <p className="text-xs text-muted-foreground">
                            Sync conversations, images, and skills across
                            devices.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span
                        className={`text-xs px-2.5 py-1 border rounded-sm ${statusTone}`}
                    >
                        {statusLabel}
                    </span>
                </div>
            </div>

            {/* Actions based on state */}
            <div className="space-y-4">
                <div className="space-y-2">
                    {(syncState === "local-only" ||
                        (syncState === "cloud-disabled" &&
                            isAuthenticated)) && (
                        <button
                            onClick={handleEnableClick}
                            disabled={
                                isLoading || isMigrating || !isInitialSyncLoaded
                            }
                            className={cn(
                                "btn-deco-primary w-full flex items-center justify-center gap-2 py-3 transition-shadow",
                                isLoading || isMigrating || !isInitialSyncLoaded
                                    ? "cursor-not-allowed opacity-70 animate-pulse"
                                    : "cursor-pointer",
                                highlightCta &&
                                    "ring-2 ring-primary/50 shadow-[0_0_12px_rgba(99,102,241,0.35)]",
                            )}
                        >
                            {isLoading ||
                            isMigrating ||
                            !isInitialSyncLoaded ? (
                                <>
                                    <Loader2
                                        size={16}
                                        className="animate-spin"
                                    />
                                    <span>
                                        {isMigrating
                                            ? `Syncing... ${migrationProgress ? Math.round(migrationProgress.percentage) : 0}%`
                                            : !isInitialSyncLoaded
                                              ? "Preparing..."
                                              : "Loading..."}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Cloud size={16} />
                                    <span>Enable Cloud Sync</span>
                                </>
                            )}
                        </button>
                    )}

                    {syncState === "cloud-enabled" && (
                        <button
                            onClick={() => setShowDisableConfirm(true)}
                            className="btn-deco-ghost w-full text-muted-foreground cursor-pointer py-3"
                        >
                            Disable Cloud Sync
                        </button>
                    )}
                </div>

                {isAuthenticated && (
                    <details className="group border border-border/60 bg-muted/20 rounded-sm">
                        <summary className="flex items-center justify-between px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer">
                            <div className="flex items-center gap-2">
                                <ChevronRight
                                    size={12}
                                    className="transition-transform group-open:rotate-90"
                                />
                                <span>Utilities</span>
                            </div>
                        </summary>
                        <div className="px-4 pb-3 space-y-3">
                            {syncState === "cloud-enabled" && (
                                <CloneToLocalButton className="text-muted-foreground" />
                            )}
                        </div>
                    </details>
                )}

                <div className="flex items-center justify-between text-xs border border-border bg-muted/30 px-4 py-3 rounded-sm">
                    <span className="text-muted-foreground">
                        {isAuthLoading
                            ? "Auth loading..."
                            : isAuthenticated
                              ? user?.email || "Signed in"
                              : "Signed out"}
                    </span>
                    <button
                        type="button"
                        onClick={handleAuthAction}
                        disabled={isAuthLoading}
                        className="text-xs font-medium text-primary hover:text-primary/80 disabled:text-muted-foreground cursor-pointer"
                    >
                        {isAuthenticated ? "Sign out" : "Sign in"}
                    </button>
                </div>

                {failedDeletes.length > 0 && (
                    <div className="flex items-start gap-3 text-xs border border-error/30 bg-error/10 px-4 py-3 rounded-sm text-error">
                        <div className="mt-0.5 h-3.5 w-3.5 shrink-0 border border-error" />
                        <div>
                            <p className="font-medium">Cloud cleanup failed</p>
                            <p className="text-error/80">
                                {failedDeletes[0]?.error ??
                                    "A delete operation could not finish."}
                            </p>
                        </div>
                    </div>
                )}

                {runningDeletes.length > 0 && (
                    <div className="flex items-start gap-3 text-xs border border-warning/30 bg-warning/10 px-4 py-3 rounded-sm text-warning">
                        <Loader2
                            size={14}
                            className="mt-0.5 animate-spin shrink-0"
                        />
                        <div>
                            <p className="font-medium">
                                Cloud cleanup in progress
                            </p>
                            <p className="text-warning/80">
                                {runningDeletes.length} delete operation
                                {runningDeletes.length === 1 ? "" : "s"} still
                                running.
                            </p>
                        </div>
                    </div>
                )}
            </div>

            {/* Enable confirmation dialog */}
            <ConfirmDialog
                open={showEnableConfirm}
                title="Enable Cloud Sync"
                description="Your local conversations will be migrated to the cloud. After migration, cloud becomes the authoritative source for your data. This is a one-time migration."
                confirmLabel="Enable Cloud Sync"
                cancelLabel="Cancel"
                onConfirm={handleEnableConfirm}
                onCancel={() => setShowEnableConfirm(false)}
            />

            {/* Disable confirmation dialog */}
            <ConfirmDialog
                open={showDisableConfirm}
                title="Disable Cloud Sync"
                description="Cloud Sync will be turned off on this device. Your cloud data will remain in the cloud. This device will use local storage until you re-enable Cloud Sync. If you want a local backup first, use “Clone Cloud Data to Local” in Utilities."
                confirmLabel="Disable Cloud Sync"
                cancelLabel="Cancel"
                onConfirm={handleDisableConfirm}
                onCancel={() => setShowDisableConfirm(false)}
            />

            {/* Sign-in confirmation dialog */}
            <ConfirmDialog
                open={showSignInConfirm}
                title="Sign In Required"
                description="You need to sign in with your Google account to enable cloud sync."
                confirmLabel="Sign In"
                cancelLabel="Cancel"
                onConfirm={() => {
                    setShowSignInConfirm(false);
                    if (signIn) {
                        storage.setSyncAutoEnableReason("login");
                        void signIn("google", { redirectTo: "/settings" });
                    }
                }}
                onCancel={() => setShowSignInConfirm(false)}
            />
        </section>
    );
}
