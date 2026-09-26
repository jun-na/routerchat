import type { ChatSession, Message, Attachment } from "../types";
import type { Skill } from "../skills";
import type { MigrationProgress, CloneProgress } from "./types";

export type {
    SyncState,
    SyncMetadata,
    MigrationProgress,
    CloneProgress,
    CloneOptions,
} from "./types";
export { DEFAULT_SYNC_METADATA } from "./types";
export {
    isThinkingLevel,
    isSearchLevel,
    toThinkingLevel,
    toSearchLevel,
    mergeByIdWithPending,
    mapConvexChatToLocal,
    mapConvexMessageToLocal,
} from "./cloud-helpers";

export type MigrationProgressCallback = (progress: MigrationProgress) => void;

export type CloneProgressCallback = (progress: CloneProgress) => void;

export interface CloneConfig {
    includeChats: boolean;
    includeMessages: boolean;
    includeAttachments: boolean;
    includeSkills: boolean;
}

export interface SkillSettings {
    defaultSkillId: string | null;
    selectedSkillId: string | null;
    selectedSkillMode: "auto" | "manual";
}

export interface SkillSettingsUpdate {
    defaultSkillId?: string | null;
    selectedSkillId?: string | null;
    selectedSkillMode?: "auto" | "manual";
}

export interface StorageAdapter {
    createChat(chat: ChatSession): Promise<string>;
    getChat(id: string): Promise<ChatSession | undefined>;
    getAllChats(): Promise<ChatSession[]>;
    updateChat(chat: ChatSession): Promise<void>;
    deleteChat(id: string): Promise<void>;

    createMessage(message: Message): Promise<string>;
    updateMessage(message: Message): Promise<void>;
    getMessagesByChat(chatId: string): Promise<Message[]>;
    deleteMessagesByChat(chatId: string): Promise<void>;
    deleteMessage(id: string): Promise<void>;

    saveAttachment(attachment: Attachment): Promise<string>;
    saveAttachments(attachments: Attachment[]): Promise<string[]>;
    getAttachment(id: string): Promise<Attachment | undefined>;
    getAttachmentsByMessage(messageId: string): Promise<Attachment[]>;
    deleteAttachment(id: string): Promise<void>;
    deleteAttachmentsByMessage(messageId: string): Promise<void>;

    getImageStorageUsage(): Promise<number>;
    getStorageUsage(): Promise<{
        bytes: number;
        messageCount: number;
        sessionCount: number;
    }>;

    getSkills(): Promise<Skill[]>;
    createSkill(skill: Skill): Promise<string>;
    updateSkill(skill: Skill): Promise<void>;
    deleteSkill(id: string): Promise<void>;
    getSkillSettings(): Promise<SkillSettings>;
    upsertSkillSettings(settings: SkillSettingsUpdate): Promise<void>;

    /** Optional cloud-only cleanup supported by adapters with remote blobs. */
    clearCloudImages?(): Promise<void>;
}

export type StorageAdapterFactory = () => StorageAdapter;

export interface MigrationSummary {
    chats: number;
    messages: number;
    attachments: number;
    totalBytes: number;
}

export async function getDataSummary(
    adapter: StorageAdapter,
): Promise<MigrationSummary> {
    const chats = await adapter.getAllChats();

    let messageCount = 0;
    let attachmentCount = 0;
    let totalBytes = 0;

    for (const chat of chats) {
        const messages = await adapter.getMessagesByChat(chat.id);
        messageCount += messages.length;

        for (const message of messages) {
            if (message.attachmentIds && message.attachmentIds.length > 0) {
                const attachments = await adapter.getAttachmentsByMessage(
                    message.id,
                );
                for (const attachment of attachments) {
                    if (!attachment.purgedAt) {
                        attachmentCount++;
                        totalBytes += attachment.size;
                    }
                }
            }
        }
    }

    return {
        chats: chats.length,
        messages: messageCount,
        attachments: attachmentCount,
        totalBytes,
    };
}

export function calculateMigrationProgress(
    phase: MigrationProgress["phase"],
    current: number,
    total: number,
    currentTable?: string,
): MigrationProgress {
    let percentage = 0;
    switch (phase) {
        case "preparing":
            percentage = 0;
            break;
        case "chats":
            percentage = total > 0 ? (current / total) * 33 : 0;
            break;
        case "messages":
            percentage = 33 + (total > 0 ? (current / total) * 33 : 0);
            break;
        case "attachments":
            percentage = 66 + (total > 0 ? (current / total) * 34 : 0);
            break;
        case "complete":
            percentage = 100;
            break;
    }

    return {
        phase,
        current,
        total: total || 1,
        currentTable,
        percentage,
    };
}

export interface MigrationContext {
    sourceAdapter: StorageAdapter;
    targetAdapter: StorageAdapter;
    onProgress: MigrationProgressCallback;
}

export interface MigrationConfig {
    includeChats: boolean;
    includeMessages: boolean;
    includeAttachments: boolean;
    includeSkills: boolean;
    includeSkillSettings: boolean;
    clearTargetFirst: boolean;
}

export const DEFAULT_MIGRATION_CONFIG: MigrationConfig = {
    includeChats: true,
    includeMessages: true,
    includeAttachments: true,
    includeSkills: true,
    includeSkillSettings: true,
    clearTargetFirst: true,
};

export async function runMigration(
    context: MigrationContext,
    config: Partial<MigrationConfig> = {},
): Promise<void> {
    const fullConfig = { ...DEFAULT_MIGRATION_CONFIG, ...config };

    const { sourceAdapter, targetAdapter, onProgress } = context;

    const dataSummary = await getDataSummary(sourceAdapter);
    const totalItems =
        (fullConfig.includeChats ? dataSummary.chats : 0) +
        (fullConfig.includeMessages ? dataSummary.messages : 0) +
        (fullConfig.includeAttachments ? dataSummary.attachments : 0) +
        (fullConfig.includeSkills ? 1 : 0);

    let processedItems = 0;

    onProgress(
        calculateMigrationProgress("preparing", 0, totalItems, "preparing"),
    );

    onProgress(calculateMigrationProgress("chats", 0, totalItems, "chats"));

    if (fullConfig.includeChats) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            await targetAdapter.createChat(chat);
            processedItems++;
            onProgress(
                calculateMigrationProgress(
                    "chats",
                    processedItems,
                    totalItems,
                    "chats",
                ),
            );
        }
    }

    onProgress(
        calculateMigrationProgress(
            "messages",
            processedItems,
            totalItems,
            "messages",
        ),
    );

    if (fullConfig.includeMessages) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            const messages = await sourceAdapter.getMessagesByChat(chat.id);
            for (const message of messages) {
                await targetAdapter.createMessage(message);
                processedItems++;
                onProgress(
                    calculateMigrationProgress(
                        "messages",
                        processedItems,
                        totalItems,
                        "messages",
                    ),
                );
            }
        }
    }

    onProgress(
        calculateMigrationProgress(
            "attachments",
            processedItems,
            totalItems,
            "attachments",
        ),
    );

    if (fullConfig.includeAttachments) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            const messages = await sourceAdapter.getMessagesByChat(chat.id);
            for (const message of messages) {
                if (message.attachmentIds) {
                    for (const attachmentId of message.attachmentIds) {
                        const attachment =
                            await sourceAdapter.getAttachment(attachmentId);
                        if (attachment) {
                            await targetAdapter.saveAttachment(attachment);
                        }
                    }
                }
                processedItems++;
                onProgress(
                    calculateMigrationProgress(
                        "attachments",
                        processedItems,
                        totalItems,
                        "attachments",
                    ),
                );
            }
        }
    }

    onProgress(calculateMigrationProgress("complete", 1, 1, "complete"));

    if (fullConfig.includeSkills) {
        const skills = await sourceAdapter.getSkills();
        for (const skill of skills) {
            await targetAdapter.createSkill(skill);
            processedItems++;
        }

        if (fullConfig.includeSkillSettings) {
            const skillSettings = await sourceAdapter.getSkillSettings();
            await targetAdapter.upsertSkillSettings(skillSettings);
        }
    }

    onProgress(calculateMigrationProgress("complete", 1, 1, "complete"));
}

export interface CloneContext {
    sourceAdapter: StorageAdapter;
    targetAdapter: StorageAdapter;
    onProgress: CloneProgressCallback;
    options?: CloneConfig;
}

export async function runClone(context: CloneContext): Promise<void> {
    const { sourceAdapter, targetAdapter, onProgress, options } = context;

    const dataSummary = await getDataSummary(sourceAdapter);
    const shouldCloneChats = options?.includeChats ?? true;
    const shouldCloneMessages = options?.includeMessages ?? true;
    const shouldCloneAttachments = options?.includeAttachments ?? true;
    const shouldCloneSkills = options?.includeSkills ?? true;

    const totalItems =
        (shouldCloneChats ? dataSummary.chats : 0) +
        (shouldCloneMessages ? dataSummary.messages : 0) +
        (shouldCloneAttachments ? dataSummary.attachments : 0) +
        (shouldCloneSkills ? 1 : 0);

    let processedItems = 0;

    const calculateCloneProgress = (
        phase: CloneProgress["phase"],
        current: number,
        currentTable?: string,
    ): CloneProgress => {
        let percentage = 0;
        switch (phase) {
            case "preparing":
                percentage = 0;
                break;
            case "chats":
                percentage = totalItems > 0 ? (current / totalItems) * 33 : 0;
                break;
            case "messages":
                percentage =
                    33 + (totalItems > 0 ? (current / totalItems) * 33 : 0);
                break;
            case "attachments":
                percentage =
                    66 + (totalItems > 0 ? (current / totalItems) * 34 : 0);
                break;
            case "complete":
                percentage = 100;
                break;
        }
        return {
            phase,
            current,
            total: totalItems || 1,
            currentTable,
            percentage,
        };
    };

    onProgress(calculateCloneProgress("preparing", 0, "preparing"));

    onProgress(calculateCloneProgress("chats", 0, "chats"));

    if (shouldCloneChats) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            await targetAdapter.createChat(chat);
            processedItems++;
            onProgress(
                calculateCloneProgress("chats", processedItems, "chats"),
            );
        }
    }

    onProgress(calculateCloneProgress("messages", processedItems, "messages"));

    if (shouldCloneMessages) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            const messages = await sourceAdapter.getMessagesByChat(chat.id);
            for (const message of messages) {
                await targetAdapter.createMessage(message);
                processedItems++;
                onProgress(
                    calculateCloneProgress(
                        "messages",
                        processedItems,
                        "messages",
                    ),
                );
            }
        }
    }

    onProgress(
        calculateCloneProgress("attachments", processedItems, "attachments"),
    );

    if (shouldCloneAttachments) {
        const chats = await sourceAdapter.getAllChats();
        for (const chat of chats) {
            const messages = await sourceAdapter.getMessagesByChat(chat.id);
            for (const message of messages) {
                if (message.attachmentIds) {
                    for (const attachmentId of message.attachmentIds) {
                        const attachment =
                            await sourceAdapter.getAttachment(attachmentId);
                        if (attachment && !attachment.purgedAt) {
                            await targetAdapter.saveAttachment(attachment);
                        }
                    }
                }
                processedItems++;
                onProgress(
                    calculateCloneProgress(
                        "attachments",
                        processedItems,
                        "attachments",
                    ),
                );
            }
        }
    }

    onProgress(calculateCloneProgress("complete", 1, "complete"));
}
