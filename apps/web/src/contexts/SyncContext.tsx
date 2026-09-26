"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    useCallback,
    useMemo,
    useSyncExternalStore,
} from "react";
import { useConvex, useConvexAuth, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type {
    SyncState,
    SyncMetadata,
    QuotaStatus,
    MigrationProgress,
    CloneProgress,
    CloneOptions,
} from "@/lib/sync/types";
import { DEFAULT_SYNC_METADATA } from "@/lib/sync/types";
import type { Id } from "@convex/_generated/dataModel";
import { type ConvexClient } from "@/lib/sync/convex-adapter";
import {
    useActiveStorageAdapter,
    useCloudAdapter,
} from "@/lib/sync/active-adapter";
import {
    runCloneCloudToLocal,
    runEnableCloudSyncMigration,
} from "@/lib/sync/migration-runner";
import { CloudflareStorageAdapter } from "@/lib/sync/cloudflare-adapter";
import { useQuotaStatus } from "@/lib/sync/quota-status";
import {
    applySyncStateChange,
    convexAvailabilityStore,
    resolveStoredSyncState,
    shouldDisableCloudOnSignOut,
} from "@/lib/sync/state-machine";
import * as storage from "@/lib/storage";
import type { StorageAdapter } from "@/lib/sync/storage-adapter";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { isCloudflareSyncEnabled } from "@/lib/sync/config";
import type { CloudflareIdentity } from "@/lib/cloudflare/access";
import { runClone, runMigration } from "@shared/core/sync";
import { getLocalStorageAdapter } from "@/lib/sync/local-adapter";

/**
 * Sync Context Type
 *
 * Provides access to sync state, actions, and the current storage adapter.
 */
interface SyncContextType {
    // State
    syncState: SyncState;
    isConvexAvailable: boolean;
    isCloudflareAvailable: boolean;
    cloudflareIdentity: CloudflareIdentity | null;
    isAuthenticated: boolean;
    syncMetadata: SyncMetadata;

    // Storage adapter (use this for all data operations)
    storageAdapter: StorageAdapter;

    // Quota info
    localQuotaStatus: QuotaStatus;
    cloudQuotaStatus: QuotaStatus | null;
    cloudStorageUsage: {
        bytes: number;
        messageCount: number;
        sessionCount: number;
    } | null;

    // Actions
    enableCloudSync: () => Promise<void>;
    disableCloudSync: () => Promise<void>;
    clearCloudImages: () => Promise<void>;
    cloneToLocal: (options?: CloneOptions) => Promise<void>;
    refreshQuotaStatus: () => Promise<void>;

    // Loading state
    isInitialSyncLoaded: boolean;

    // Migration state
    isMigrating: boolean;
    migrationProgress: MigrationProgress | null;

    // Clone state
    isCloning: boolean;
    cloneProgress: CloneProgress | null;
}

const SyncContext = createContext<SyncContextType | null>(null);
const cloudflareStorageAdapter = new CloudflareStorageAdapter();

/**
 * Sync Provider
 *
 * Manages the sync state machine and provides access to the appropriate
 * storage adapter based on the current sync state.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
    if (isCloudflareSyncEnabled()) {
        return <CloudflareSyncProvider>{children}</CloudflareSyncProvider>;
    }

    return <ConvexSyncProvider>{children}</ConvexSyncProvider>;
}

function ConvexSyncProvider({ children }: { children: React.ReactNode }) {
    const convexAvailability = useSyncExternalStore(
        convexAvailabilityStore.subscribe,
        convexAvailabilityStore.getSnapshot,
        convexAvailabilityStore.getServerSnapshot,
    );

    if (!convexAvailability.isChecked) {
        return <LoadingScreen />;
    }

    if (!convexAvailability.isAvailable) {
        return (
            <SyncProviderBase isConvexAvailable={false}>
                {children}
            </SyncProviderBase>
        );
    }

    return (
        <SyncProviderWithAuth
            isConvexAvailable={convexAvailability.isAvailable}
        >
            {children}
        </SyncProviderWithAuth>
    );
}

function CloudflareSyncProvider({ children }: { children: React.ReactNode }) {
    const [isLoading, setIsLoading] = useState(true);
    const [identity, setIdentity] = useState<CloudflareIdentity | null>(null);
    const adapter = identity ? cloudflareStorageAdapter : null;

    useEffect(() => {
        let active = true;
        void fetch("/api/cloudflare/session", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok)
                    throw new Error("Cloudflare session unavailable");
                const body = (await response.json()) as {
                    identity?: CloudflareIdentity;
                };
                if (!body.identity?.userId || !body.identity.email) {
                    throw new Error("Cloudflare session is invalid");
                }
                if (active) setIdentity(body.identity);
            })
            .catch(() => {
                if (active) setIdentity(null);
            })
            .finally(() => {
                if (active) setIsLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    if (isLoading) return <LoadingScreen />;

    return (
        <SyncProviderBase
            isConvexAvailable={false}
            isCloudflareAvailable={Boolean(identity)}
            cloudflareIdentity={identity}
            cloudflareAdapter={adapter}
            isAuthenticated={Boolean(identity)}
        >
            {children}
        </SyncProviderBase>
    );
}

function SyncProviderWithAuth({
    children,
    isConvexAvailable,
}: {
    children: React.ReactNode;
    isConvexAvailable: boolean;
}) {
    const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
    const convexClient: ConvexClient = useConvex();
    const userId = useQuery(api.users.getCurrentUserId, {});
    const user = useQuery(api.users.get, userId ? { id: userId } : "skip");

    return (
        <SyncProviderBase
            isConvexAvailable={isConvexAvailable}
            convexClient={convexClient}
            convexUserId={userId ?? null}
            initialSync={user?.initialSync}
            isAuthenticated={isAuthenticated}
            isAuthLoading={isAuthLoading}
        >
            {children}
        </SyncProviderBase>
    );
}

function SyncProviderBase({
    children,
    isConvexAvailable,
    isCloudflareAvailable = false,
    cloudflareIdentity = null,
    cloudflareAdapter = null,
    convexClient,
    convexUserId,
    initialSync,
    isAuthenticated = false,
    isAuthLoading = false,
}: {
    children: React.ReactNode;
    isConvexAvailable: boolean;
    isCloudflareAvailable?: boolean;
    cloudflareIdentity?: CloudflareIdentity | null;
    cloudflareAdapter?: StorageAdapter | null;
    convexClient?: ConvexClient | null;
    convexUserId?: Id<"users"> | null;
    initialSync?: boolean;
    isAuthenticated?: boolean;
    isAuthLoading?: boolean;
}) {
    // Core state
    const [syncState, setSyncStateInternal] = useState<SyncState>("local-only");
    const [syncMetadata, setSyncMetadataInternal] = useState<SyncMetadata>(
        DEFAULT_SYNC_METADATA,
    );
    const [isStorageHydrated, setIsStorageHydrated] = useState(false);

    const [cloudAdapterEpoch, setCloudAdapterEpoch] = useState(0);
    const invalidateCloudAdapter = useCallback(() => {
        setCloudAdapterEpoch((prev) => prev + 1);
    }, []);

    const convexCloudAdapter = useCloudAdapter(
        convexClient,
        convexUserId,
        cloudAdapterEpoch,
    );
    const cloudAdapter = cloudflareAdapter ?? convexCloudAdapter;
    const isCloudAvailable = isConvexAvailable || isCloudflareAvailable;
    const storageAdapter = useActiveStorageAdapter({
        cloudAdapter,
        isCloudAvailable,
        syncState,
        isAuthenticated,
    });
    const {
        localQuotaStatus,
        cloudQuotaStatus,
        cloudStorageUsage,
        refreshQuotaStatus,
        clearCloudImages,
    } = useQuotaStatus({
        cloudAdapter,
        convexClient,
        isAuthenticated,
        onCloudImagesCleared: invalidateCloudAdapter,
    });

    // Migration state
    const [isMigrating, setIsMigrating] = useState(false);
    const [migrationProgress, setMigrationProgress] =
        useState<MigrationProgress | null>(null);

    // Clone state
    const [isCloning, setIsCloning] = useState(false);
    const [cloneProgress, setCloneProgress] = useState<CloneProgress | null>(
        null,
    );

    // Initialize state from localStorage
    useEffect(() => {
        if (typeof window === "undefined") return;

        const storedState = storage.getSyncState();
        const storedMetadata = storage.getSyncMetadata();
        const resolved = resolveStoredSyncState({
            isConvexAvailable: isCloudAvailable,
            storedState,
            storedMetadata,
        });
        const isCloudflareAccountChanged =
            isCloudflareAvailable &&
            Boolean(cloudflareIdentity?.userId) &&
            Boolean(storedMetadata.cloudUserId) &&
            storedMetadata.cloudUserId !== cloudflareIdentity?.userId;
        const nextSyncState = isCloudflareAccountChanged
            ? "cloud-disabled"
            : resolved.syncState;
        const nextSyncMetadata = isCloudflareAccountChanged
            ? { ...resolved.syncMetadata, syncState: "cloud-disabled" as const }
            : resolved.syncMetadata;

        if (isCloudflareAccountChanged) {
            storage.setSyncState(nextSyncState);
            storage.updateSyncMetadata(nextSyncMetadata);
        }

        setSyncStateInternal(nextSyncState);
        setSyncMetadataInternal(nextSyncMetadata);

        setIsStorageHydrated(true);
    }, [cloudflareIdentity?.userId, isCloudAvailable, isCloudflareAvailable]);

    // Update sync state and persist
    const updateSyncState = useCallback(
        (newState: SyncState) => {
            setSyncStateInternal(newState);
            storage.setSyncState(newState);

            const nextMetadata = applySyncStateChange({
                previousMetadata: storage.getSyncMetadata(),
                nextState: newState,
            });
            if (isCloudflareAvailable && cloudflareIdentity) {
                nextMetadata.cloudUserId = cloudflareIdentity.userId;
            }
            const updatedMetadata = storage.updateSyncMetadata(nextMetadata);
            setSyncMetadataInternal(updatedMetadata);
        },
        [cloudflareIdentity, isCloudflareAvailable],
    );

    // Disable cloud sync when signed out
    useEffect(() => {
        if (typeof window === "undefined") return;
        if (isAuthLoading) return;

        if (
            shouldDisableCloudOnSignOut({
                isAuthLoading,
                isAuthenticated,
                syncState,
            })
        ) {
            updateSyncState("cloud-disabled");
        }
    }, [isAuthLoading, isAuthenticated, syncState, updateSyncState]);

    // Enable cloud sync (local-only -> cloud-enabled)
    const enableCloudSync = useCallback(async () => {
        const isCloudflare =
            isCloudflareAvailable && Boolean(cloudflareAdapter);
        if (!isCloudAvailable) {
            throw new Error("Convex is not configured");
        }

        if (syncState !== "local-only" && syncState !== "cloud-disabled") {
            throw new Error(
                `Cannot enable cloud sync from state: ${syncState}`,
            );
        }

        if (!isAuthenticated) {
            throw new Error("Sign in required for cloud sync");
        }

        if (isConvexAvailable && initialSync === undefined) {
            return;
        }

        if (!cloudAdapter || (!isCloudflare && !convexClient)) {
            throw new Error("Cloud storage is not available");
        }

        setIsMigrating(true);
        setMigrationProgress({
            phase: "chats",
            current: 0,
            total: 0,
            percentage: 0,
        });

        try {
            if (isCloudflare) {
                await runMigration(
                    {
                        sourceAdapter: getLocalStorageAdapter(),
                        targetAdapter: cloudAdapter,
                        onProgress: setMigrationProgress,
                    },
                    { clearTargetFirst: false },
                );
            } else {
                if (!convexUserId || !convexClient) {
                    throw new Error("User not loaded");
                }

                await runEnableCloudSyncMigration({
                    initialSync: Boolean(initialSync),
                    convexClient,
                    convexUserId,
                    cloudAdapter: convexCloudAdapter!,
                    setMigrationProgress,
                });
            }

            updateSyncState("cloud-enabled");
            storage.updateSyncMetadata({
                migrationCompletedAt: Date.now(),
            });
        } catch (error) {
            console.error("Migration failed:", error);
            throw error;
        } finally {
            setIsMigrating(false);
            setMigrationProgress(null);
        }
    }, [
        cloudAdapter,
        cloudflareAdapter,
        isCloudAvailable,
        isCloudflareAvailable,
        convexClient,
        convexCloudAdapter,
        convexUserId,
        initialSync,
        isAuthenticated,
        isConvexAvailable,
        syncState,
        updateSyncState,
    ]);

    // Disable cloud sync (cloud-enabled -> cloud-disabled)
    const disableCloudSync = useCallback(async () => {
        if (syncState !== "cloud-enabled") {
            throw new Error(
                `Cannot disable cloud sync from state: ${syncState}`,
            );
        }

        setIsCloning(true);
        setCloneProgress({
            phase: "chats",
            current: 0,
            total: 0,
            percentage: 0,
        });

        try {
            updateSyncState("cloud-disabled");
        } catch (error) {
            console.error("Failed to disable cloud sync:", error);
            throw error;
        } finally {
            setIsCloning(false);
            setCloneProgress(null);
        }
    }, [syncState, updateSyncState]);

    // Clone cloud data to local (without changing sync state)
    const cloneToLocal = useCallback(
        async (options?: CloneOptions) => {
            if (syncState !== "cloud-enabled") {
                throw new Error(
                    "Clone to local only available when cloud sync is enabled",
                );
            }

            if (!isAuthenticated) {
                throw new Error("Sign in required for clone to local");
            }

            setIsCloning(true);
            setCloneProgress({
                phase: "chats",
                current: 0,
                total: 0,
                percentage: 0,
            });

            if (!cloudAdapter) {
                throw new Error("Cloud storage is not available");
            }

            try {
                if (isCloudflareAvailable) {
                    await runClone({
                        sourceAdapter: cloudAdapter,
                        targetAdapter: getLocalStorageAdapter(),
                        options: {
                            includeChats: true,
                            includeMessages: true,
                            includeAttachments: !options?.textOnly,
                            includeSkills: true,
                        },
                        onProgress: setCloneProgress,
                    });
                } else {
                    if (!convexClient) {
                        throw new Error("Convex is not configured");
                    }
                    await runCloneCloudToLocal({
                        convexClient,
                        cloudAdapter: convexCloudAdapter!,
                        options,
                        setCloneProgress,
                    });
                }
                await refreshQuotaStatus();
            } catch (error) {
                console.error("Clone to local failed:", error);
                throw error;
            } finally {
                setIsCloning(false);
                setCloneProgress(null);
            }
        },
        [
            cloudAdapter,
            convexCloudAdapter,
            convexClient,
            isCloudflareAvailable,
            isAuthenticated,
            refreshQuotaStatus,
            syncState,
        ],
    );

    const isInitialSyncLoaded =
        !isConvexAvailable ||
        initialSync !== undefined ||
        isCloudflareAvailable;

    // During refresh, prevent loading local data when cloud sync is enabled by
    // gating the app behind a full-screen loader until cloud availability is
    // resolved and the cloud adapter is ready.
    const shouldBlockChildren =
        !isStorageHydrated ||
        (isCloudAvailable &&
            syncState === "cloud-enabled" &&
            (isAuthLoading || !isAuthenticated || !cloudAdapter));

    const contextValue = useMemo(
        () => ({
            syncState,
            isConvexAvailable,
            isCloudflareAvailable,
            cloudflareIdentity,
            isAuthenticated,
            syncMetadata,
            storageAdapter,
            localQuotaStatus,
            cloudQuotaStatus,
            cloudStorageUsage,
            clearCloudImages,
            enableCloudSync,
            disableCloudSync,
            cloneToLocal,
            refreshQuotaStatus,
            isInitialSyncLoaded,
            isMigrating,
            migrationProgress,
            isCloning,
            cloneProgress,
        }),
        [
            syncState,
            isConvexAvailable,
            isCloudflareAvailable,
            cloudflareIdentity,
            isAuthenticated,
            syncMetadata,
            storageAdapter,
            localQuotaStatus,
            cloudQuotaStatus,
            cloudStorageUsage,
            clearCloudImages,
            enableCloudSync,
            disableCloudSync,
            cloneToLocal,
            refreshQuotaStatus,
            isInitialSyncLoaded,
            isMigrating,
            migrationProgress,
            isCloning,
            cloneProgress,
        ],
    );

    return (
        <SyncContext.Provider value={contextValue}>
            {shouldBlockChildren ? <LoadingScreen /> : children}
        </SyncContext.Provider>
    );
}

/**
 * Hook to access sync context
 */
export function useSync(): SyncContextType {
    const context = useContext(SyncContext);
    if (!context) {
        throw new Error("useSync must be used within a SyncProvider");
    }
    return context;
}

/**
 * Hook to check if cloud sync is available (Convex configured + signed in)
 */
export function useIsCloudSyncAvailable(): boolean {
    const { isConvexAvailable, isCloudflareAvailable, isAuthenticated } =
        useSync();
    return (isConvexAvailable || isCloudflareAvailable) && isAuthenticated;
}

/**
 * Hook to get the current storage adapter
 */
export function useStorageAdapter(): StorageAdapter {
    const { storageAdapter } = useSync();
    return storageAdapter;
}
