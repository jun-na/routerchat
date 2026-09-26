"use client";

import type { Attachment, ChatSession, Message, Skill } from "@/lib/types";
import type {
    SkillSettings,
    SkillSettingsUpdate,
    StorageAdapter,
} from "./storage-adapter";

interface StorageResponse<T> {
    result?: T;
    error?: string;
}

/** StorageAdapter backed by the same-origin Cloudflare D1 and R2 routes. */
export class CloudflareStorageAdapter implements StorageAdapter {
    private async call<T>(
        op: string,
        payload: Record<string, unknown> = {},
    ): Promise<T> {
        const response = await fetch("/api/cloudflare/storage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ op, ...payload }),
        });

        let body: StorageResponse<T>;
        try {
            body = (await response.json()) as StorageResponse<T>;
        } catch {
            throw new Error(`Cloudflare storage returned ${response.status}`);
        }

        if (!response.ok) {
            throw new Error(
                body.error ?? `Cloudflare storage failed (${response.status})`,
            );
        }
        return body.result as T;
    }

    async createChat(chat: ChatSession): Promise<string> {
        return this.call<string>("chats.put", { chat });
    }

    async getChat(id: string): Promise<ChatSession | undefined> {
        return this.call<ChatSession | undefined>("chats.get", { id });
    }

    async getAllChats(): Promise<ChatSession[]> {
        return this.call<ChatSession[]>("chats.list");
    }

    async updateChat(chat: ChatSession): Promise<void> {
        await this.call("chats.put", { chat });
    }

    async deleteChat(id: string): Promise<void> {
        await this.call("chats.delete", { id });
    }

    async createMessage(message: Message): Promise<string> {
        return this.call<string>("messages.put", { message });
    }

    async updateMessage(message: Message): Promise<void> {
        await this.call("messages.put", { message });
    }

    async getMessagesByChat(chatId: string): Promise<Message[]> {
        return this.call<Message[]>("messages.list", { parentId: chatId });
    }

    async deleteMessagesByChat(chatId: string): Promise<void> {
        await this.call("messages.deleteByChat", { id: chatId });
    }

    async deleteMessage(id: string): Promise<void> {
        await this.call("messages.delete", { id });
    }

    async saveAttachment(attachment: Attachment): Promise<string> {
        return this.call<string>("attachments.put", { attachment });
    }

    async saveAttachments(attachments: Attachment[]): Promise<string[]> {
        const ids: string[] = [];
        for (const attachment of attachments) {
            ids.push(await this.saveAttachment(attachment));
        }
        return ids;
    }

    async getAttachment(id: string): Promise<Attachment | undefined> {
        return this.call<Attachment | undefined>("attachments.get", { id });
    }

    async getAttachmentsByMessage(messageId: string): Promise<Attachment[]> {
        return this.call<Attachment[]>("attachments.list", {
            parentId: messageId,
        });
    }

    async deleteAttachment(id: string): Promise<void> {
        await this.call("attachments.delete", { id });
    }

    async deleteAttachmentsByMessage(messageId: string): Promise<void> {
        await this.call("attachments.deleteByMessage", { id: messageId });
    }

    async getImageStorageUsage(): Promise<number> {
        return this.call<number>("attachments.imageUsage");
    }

    async getStorageUsage(): Promise<{
        bytes: number;
        messageCount: number;
        sessionCount: number;
    }> {
        return this.call("usage");
    }

    async getSkills(): Promise<Skill[]> {
        return this.call<Skill[]>("skills.list");
    }

    async createSkill(skill: Skill): Promise<string> {
        return this.call<string>("skills.put", { skill });
    }

    async updateSkill(skill: Skill): Promise<void> {
        await this.call("skills.put", { skill });
    }

    async deleteSkill(id: string): Promise<void> {
        await this.call("skills.delete", { id });
    }

    async getSkillSettings(): Promise<SkillSettings> {
        return this.call<SkillSettings>("skillSettings.get");
    }

    async upsertSkillSettings(settings: SkillSettingsUpdate): Promise<void> {
        await this.call("skillSettings.put", { settings });
    }

    async clearCloudImages(): Promise<void> {
        await this.call<number>("attachments.clearImages");
    }
}
