import { authenticateCloudflareAccess } from "@/lib/cloudflare/access";
import type { D1Database, R2Bucket } from "@/lib/cloudflare/bindings";
import { getCloudflareBindings } from "@/lib/cloudflare/runtime";
import type { Attachment, ChatSession, Message, Skill } from "@/lib/types";
import type {
    SkillSettings,
    SkillSettingsUpdate,
} from "@/lib/sync/storage-adapter";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_USER_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const MAX_CHATS_PER_USER = 5_000;
const MAX_MESSAGES_PER_USER = 20_000;
const MAX_SKILLS_PER_USER = 500;
const MAX_ATTACHMENTS_PER_USER = 50_000;
const MAX_ATTACHMENTS_PER_MESSAGE = 50;

interface StoredRow {
    payload: string;
    storage_key?: string | null;
}

interface StoredAttachmentRow extends StoredRow {
    local_id: string;
    message_id: string;
    storage_key: string | null;
}

interface StorageRequest {
    op?: string;
    id?: string;
    parentId?: string;
    chat?: ChatSession;
    message?: Message;
    attachment?: Attachment;
    skill?: Skill;
    settings?: SkillSettingsUpdate;
}

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 200) {
        throw new Error(`Invalid ${field}`);
    }
    return value;
}

function assertMaxLength(
    value: unknown,
    field: string,
    maxLength: number,
): void {
    if (value !== undefined && value !== null) {
        if (typeof value !== "string" || value.length > maxLength) {
            throw new Error(
                `${field} exceeds the ${maxLength} character limit`,
            );
        }
    }
}

function readPayload<T>(payload: string): T {
    return JSON.parse(payload) as T;
}

async function getPayload<T>(
    db: D1Database,
    sql: string,
    values: unknown[],
): Promise<T | undefined> {
    const row = await db
        .prepare(sql)
        .bind(...values)
        .first<StoredRow>();
    return row ? readPayload<T>(row.payload) : undefined;
}

async function getStorageKey(
    db: D1Database,
    userId: string,
    localId: string,
): Promise<string | null> {
    const row = await db
        .prepare(
            "SELECT storage_key FROM attachments WHERE user_id = ? AND local_id = ?",
        )
        .bind(userId, localId)
        .first<{ storage_key: string | null }>();
    return row?.storage_key ?? null;
}

function decodeBase64(value: string): Uint8Array {
    const base64 = value.startsWith("data:")
        ? (value.split(",")[1] ?? "")
        : value;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize),
        );
    }
    return btoa(binary);
}

function attachmentStorageKey(userId: string, attachmentId: string): string {
    return `${userId}/attachments/${encodeURIComponent(attachmentId)}`;
}

async function materializeAttachment(
    row: StoredAttachmentRow,
    bucket?: R2Bucket,
): Promise<Attachment> {
    const attachment = readPayload<Attachment>(row.payload);
    if (attachment.purgedAt || attachment.url || !row.storage_key) {
        return { ...attachment, data: "" };
    }
    if (!bucket) throw new Error("Cloud attachment storage is unavailable");

    const object = await bucket.get(row.storage_key);
    if (!object) return { ...attachment, data: "", purgedAt: Date.now() };

    return {
        ...attachment,
        data: encodeBase64(new Uint8Array(await object.arrayBuffer())),
    };
}

async function deleteAttachmentObjects(
    bucket: R2Bucket | undefined,
    rows: Array<{ storage_key: string | null }>,
): Promise<void> {
    if (!bucket) return;
    await Promise.all(
        rows
            .map((row) => row.storage_key)
            .filter((key): key is string => Boolean(key))
            .map((key) => bucket.delete(key)),
    );
}

async function deleteMessageAttachments(
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
    where: "chat_id" | "message_id",
    value: string,
): Promise<void> {
    const chatAttachments =
        where === "chat_id"
            ? "SELECT storage_key FROM attachments WHERE user_id = ? AND message_id IN (SELECT local_id FROM messages WHERE user_id = ? AND chat_id = ?)"
            : "SELECT storage_key FROM attachments WHERE user_id = ? AND message_id = ?";
    const values =
        where === "chat_id" ? [userId, userId, value] : [userId, value];
    const rows = await db
        .prepare(chatAttachments)
        .bind(...values)
        .all<{ storage_key: string | null }>();
    await deleteAttachmentObjects(bucket, rows.results);

    if (where === "chat_id") {
        await db
            .prepare(
                "DELETE FROM attachments WHERE user_id = ? AND message_id IN (SELECT local_id FROM messages WHERE user_id = ? AND chat_id = ?)",
            )
            .bind(userId, userId, value)
            .run();
    } else {
        await db
            .prepare(
                "DELETE FROM attachments WHERE user_id = ? AND message_id = ?",
            )
            .bind(userId, value)
            .run();
    }
}

async function handleChats(
    request: StorageRequest,
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<unknown> {
    switch (request.op) {
        case "chats.list": {
            const rows = await db
                .prepare(
                    "SELECT payload FROM chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5000",
                )
                .bind(userId)
                .all<StoredRow>();
            return rows.results.map((row) =>
                readPayload<ChatSession>(row.payload),
            );
        }
        case "chats.get": {
            const id = requireString(request.id, "chat id");
            return await getPayload<ChatSession>(
                db,
                "SELECT payload FROM chats WHERE user_id = ? AND local_id = ?",
                [userId, id],
            );
        }
        case "chats.put": {
            const chat = request.chat;
            if (!chat || typeof chat !== "object")
                throw new Error("Invalid chat");
            const id = requireString(chat.id, "chat id");
            assertMaxLength(chat.title, "Chat title", 500);
            const existing = await db
                .prepare(
                    "SELECT 1 FROM chats WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .first();
            if (!existing) {
                const count = await db
                    .prepare(
                        "SELECT COUNT(*) AS count FROM chats WHERE user_id = ?",
                    )
                    .bind(userId)
                    .first<{ count: number }>();
                if ((count?.count ?? 0) >= MAX_CHATS_PER_USER) {
                    throw new Error("User chat limit exceeded");
                }
            }
            await db
                .prepare(
                    "INSERT INTO chats (user_id, local_id, updated_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, local_id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload",
                )
                .bind(userId, id, chat.updatedAt, JSON.stringify(chat))
                .run();
            return id;
        }
        case "chats.delete": {
            const id = requireString(request.id, "chat id");
            await deleteMessageAttachments(db, bucket, userId, "chat_id", id);
            await db
                .prepare(
                    "DELETE FROM messages WHERE user_id = ? AND chat_id = ?",
                )
                .bind(userId, id)
                .run();
            await db
                .prepare("DELETE FROM chats WHERE user_id = ? AND local_id = ?")
                .bind(userId, id)
                .run();
            return null;
        }
        default:
            throw new Error("Unsupported storage operation");
    }
}

async function handleMessages(
    request: StorageRequest,
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<unknown> {
    switch (request.op) {
        case "messages.list": {
            const chatId = requireString(request.parentId, "chat id");
            const rows = await db
                .prepare(
                    "SELECT payload FROM messages WHERE user_id = ? AND chat_id = ? ORDER BY created_at ASC LIMIT 20000",
                )
                .bind(userId, chatId)
                .all<StoredRow>();
            return rows.results.map((row) => readPayload<Message>(row.payload));
        }
        case "messages.put": {
            const message = request.message;
            if (!message || typeof message !== "object") {
                throw new Error("Invalid message");
            }
            const id = requireString(message.id, "message id");
            const chatId = requireString(message.sessionId, "chat id");
            assertMaxLength(message.content, "Message content", 200_000);
            assertMaxLength(message.contextContent, "Message context", 200_000);
            assertMaxLength(message.thinking, "Message thinking", 200_000);
            if (
                (message.attachmentIds?.length ?? 0) >
                MAX_ATTACHMENTS_PER_MESSAGE
            ) {
                throw new Error("Message attachment limit exceeded");
            }
            const chatExists = await db
                .prepare(
                    "SELECT 1 FROM chats WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, chatId)
                .first();
            if (!chatExists) throw new Error("Chat not found");
            const existing = await db
                .prepare(
                    "SELECT 1 FROM messages WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .first();
            if (!existing) {
                const count = await db
                    .prepare(
                        "SELECT COUNT(*) AS count FROM messages WHERE user_id = ?",
                    )
                    .bind(userId)
                    .first<{ count: number }>();
                if ((count?.count ?? 0) >= MAX_MESSAGES_PER_USER) {
                    throw new Error("User message limit exceeded");
                }
            }
            await db
                .prepare(
                    "INSERT INTO messages (user_id, local_id, chat_id, created_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, local_id) DO UPDATE SET chat_id = excluded.chat_id, created_at = excluded.created_at, payload = excluded.payload",
                )
                .bind(
                    userId,
                    id,
                    chatId,
                    message.createdAt,
                    JSON.stringify(message),
                )
                .run();
            return id;
        }
        case "messages.delete": {
            const id = requireString(request.id, "message id");
            await deleteMessageAttachments(
                db,
                bucket,
                userId,
                "message_id",
                id,
            );
            await db
                .prepare(
                    "DELETE FROM messages WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .run();
            return null;
        }
        case "messages.deleteByChat": {
            const chatId = requireString(request.id, "chat id");
            await deleteMessageAttachments(
                db,
                bucket,
                userId,
                "chat_id",
                chatId,
            );
            await db
                .prepare(
                    "DELETE FROM messages WHERE user_id = ? AND chat_id = ?",
                )
                .bind(userId, chatId)
                .run();
            return null;
        }
        default:
            throw new Error("Unsupported storage operation");
    }
}

async function putAttachment(
    request: StorageRequest,
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<string> {
    const attachment = request.attachment;
    if (!attachment || typeof attachment !== "object") {
        throw new Error("Invalid attachment");
    }
    const id = requireString(attachment.id, "attachment id");
    const messageId = requireString(attachment.messageId, "message id");
    if (
        !Number.isSafeInteger(attachment.size) ||
        attachment.size < 0 ||
        attachment.size > MAX_ATTACHMENT_BYTES
    ) {
        throw new Error("Invalid attachment size");
    }
    const messageExists = await db
        .prepare("SELECT 1 FROM messages WHERE user_id = ? AND local_id = ?")
        .bind(userId, messageId)
        .first();
    if (!messageExists) throw new Error("Message not found");

    const attachmentCount = await db
        .prepare(
            "SELECT COUNT(*) AS count FROM attachments WHERE user_id = ? AND message_id = ? AND local_id != ?",
        )
        .bind(userId, messageId, id)
        .first<{ count: number }>();
    if ((attachmentCount?.count ?? 0) >= MAX_ATTACHMENTS_PER_MESSAGE) {
        throw new Error("Message attachment limit exceeded");
    }
    const userAttachmentCount = await db
        .prepare(
            "SELECT COUNT(*) AS count FROM attachments WHERE user_id = ? AND local_id != ?",
        )
        .bind(userId, id)
        .first<{ count: number }>();
    if ((userAttachmentCount?.count ?? 0) >= MAX_ATTACHMENTS_PER_USER) {
        throw new Error("User attachment count limit exceeded");
    }

    const previousKey = await getStorageKey(db, userId, id);
    let storageKey: string | null = null;
    let storedSize = attachment.size;
    if (attachment.data && !attachment.url && !attachment.purgedAt) {
        if (!bucket) throw new Error("Cloud attachment storage is unavailable");
        if (attachment.size > MAX_ATTACHMENT_BYTES) {
            throw new Error("Attachment exceeds the 10 MiB Cloudflare limit");
        }
        let bytes: Uint8Array;
        try {
            bytes = decodeBase64(attachment.data);
        } catch {
            throw new Error("Invalid attachment data");
        }
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
            throw new Error("Attachment exceeds the 10 MiB Cloudflare limit");
        }
        const previous = await db
            .prepare(
                "SELECT size, storage_key FROM attachments WHERE user_id = ? AND local_id = ?",
            )
            .bind(userId, id)
            .first<{ size: number; storage_key: string | null }>();
        const userUsage = await db
            .prepare(
                "SELECT COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE user_id = ? AND storage_key IS NOT NULL",
            )
            .bind(userId)
            .first<{ bytes: number }>();
        const nextUserUsage =
            (userUsage?.bytes ?? 0) -
            (previous?.storage_key ? previous.size : 0) +
            bytes.byteLength;
        if (nextUserUsage > MAX_USER_ATTACHMENT_BYTES) {
            throw new Error("User attachment storage limit exceeded");
        }
        storedSize = bytes.byteLength;
        storageKey = attachmentStorageKey(userId, id);
        await bucket.put(storageKey, bytes, {
            httpMetadata: { contentType: attachment.mimeType },
        });
    }
    if (previousKey && previousKey !== storageKey) {
        await bucket?.delete(previousKey);
    }

    const metadata: Attachment = { ...attachment, size: storedSize, data: "" };
    await db
        .prepare(
            "INSERT INTO attachments (user_id, local_id, message_id, type, size, purged_at, storage_key, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, local_id) DO UPDATE SET message_id = excluded.message_id, type = excluded.type, size = excluded.size, purged_at = excluded.purged_at, storage_key = excluded.storage_key, payload = excluded.payload",
        )
        .bind(
            userId,
            id,
            messageId,
            attachment.type,
            storedSize,
            attachment.purgedAt ?? null,
            storageKey,
            JSON.stringify(metadata),
        )
        .run();
    return id;
}

async function clearCloudImages(
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<number> {
    const rows = await db
        .prepare(
            "SELECT local_id, storage_key, payload FROM attachments WHERE user_id = ? AND type = 'image' AND purged_at IS NULL LIMIT 50000",
        )
        .bind(userId)
        .all<StoredAttachmentRow>();
    await deleteAttachmentObjects(bucket, rows.results);
    const purgedAt = Date.now();
    for (const row of rows.results) {
        const attachment = readPayload<Attachment>(row.payload);
        const metadata = { ...attachment, data: "", purgedAt };
        await db
            .prepare(
                "UPDATE attachments SET purged_at = ?, storage_key = NULL, payload = ? WHERE user_id = ? AND local_id = ?",
            )
            .bind(purgedAt, JSON.stringify(metadata), userId, row.local_id)
            .run();
    }
    return rows.results.length;
}

async function handleAttachments(
    request: StorageRequest,
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<unknown> {
    switch (request.op) {
        case "attachments.get": {
            const id = requireString(request.id, "attachment id");
            const row = await db
                .prepare(
                    "SELECT payload, storage_key FROM attachments WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .first<StoredAttachmentRow>();
            return row ? await materializeAttachment(row, bucket) : undefined;
        }
        case "attachments.list": {
            const messageId = requireString(request.parentId, "message id");
            const rows = await db
                .prepare(
                    "SELECT local_id, message_id, payload, storage_key FROM attachments WHERE user_id = ? AND message_id = ? ORDER BY rowid ASC LIMIT 50",
                )
                .bind(userId, messageId)
                .all<StoredAttachmentRow>();
            return await Promise.all(
                rows.results.map((row) => materializeAttachment(row, bucket)),
            );
        }
        case "attachments.put":
            return await putAttachment(request, db, bucket, userId);
        case "attachments.delete": {
            const id = requireString(request.id, "attachment id");
            const key = await getStorageKey(db, userId, id);
            if (key) await bucket?.delete(key);
            await db
                .prepare(
                    "DELETE FROM attachments WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .run();
            return null;
        }
        case "attachments.deleteByMessage": {
            const messageId = requireString(request.id, "message id");
            await deleteMessageAttachments(
                db,
                bucket,
                userId,
                "message_id",
                messageId,
            );
            return null;
        }
        case "attachments.imageUsage": {
            const row = await db
                .prepare(
                    "SELECT COALESCE(SUM(size), 0) AS bytes FROM attachments WHERE user_id = ? AND type = 'image' AND purged_at IS NULL",
                )
                .bind(userId)
                .first<{ bytes: number }>();
            return row?.bytes ?? 0;
        }
        case "attachments.clearImages":
            return await clearCloudImages(db, bucket, userId);
        default:
            throw new Error("Unsupported storage operation");
    }
}

async function handleUsage(db: D1Database, userId: string): Promise<unknown> {
    const row = await db
        .prepare(
            "SELECT (SELECT COALESCE(SUM(size), 0) FROM attachments WHERE user_id = ? AND purged_at IS NULL) AS bytes, (SELECT COUNT(*) FROM messages WHERE user_id = ?) AS messageCount, (SELECT COUNT(*) FROM chats WHERE user_id = ?) AS sessionCount",
        )
        .bind(userId, userId, userId)
        .first<{
            bytes: number;
            messageCount: number;
            sessionCount: number;
        }>();
    return row ?? { bytes: 0, messageCount: 0, sessionCount: 0 };
}

async function handleSkills(
    request: StorageRequest,
    db: D1Database,
    userId: string,
): Promise<unknown> {
    switch (request.op) {
        case "skills.list": {
            const rows = await db
                .prepare(
                    "SELECT payload FROM skills WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500",
                )
                .bind(userId)
                .all<StoredRow>();
            return rows.results.map((row) => readPayload<Skill>(row.payload));
        }
        case "skills.put": {
            const skill = request.skill;
            if (!skill || typeof skill !== "object") {
                throw new Error("Invalid skill");
            }
            const id = requireString(skill.id, "skill id");
            assertMaxLength(skill.name, "Skill name", 200);
            assertMaxLength(skill.description, "Skill description", 5_000);
            assertMaxLength(skill.prompt, "Skill prompt", 100_000);
            const existing = await db
                .prepare(
                    "SELECT 1 FROM skills WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .first();
            if (!existing) {
                const count = await db
                    .prepare(
                        "SELECT COUNT(*) AS count FROM skills WHERE user_id = ?",
                    )
                    .bind(userId)
                    .first<{ count: number }>();
                if ((count?.count ?? 0) >= MAX_SKILLS_PER_USER) {
                    throw new Error("User skill limit exceeded");
                }
            }
            await db
                .prepare(
                    "INSERT INTO skills (user_id, local_id, updated_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, local_id) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload",
                )
                .bind(userId, id, skill.createdAt, JSON.stringify(skill))
                .run();
            return id;
        }
        case "skills.delete": {
            const id = requireString(request.id, "skill id");
            await db
                .prepare(
                    "DELETE FROM skills WHERE user_id = ? AND local_id = ?",
                )
                .bind(userId, id)
                .run();
            return null;
        }
        default:
            throw new Error("Unsupported storage operation");
    }
}

async function getSkillSettings(
    db: D1Database,
    userId: string,
): Promise<SkillSettings> {
    const row = await db
        .prepare(
            "SELECT default_skill_id, selected_skill_id, selected_skill_mode FROM skill_settings WHERE user_id = ?",
        )
        .bind(userId)
        .first<{
            default_skill_id: string | null;
            selected_skill_id: string | null;
            selected_skill_mode: "auto" | "manual";
        }>();
    return {
        defaultSkillId: row?.default_skill_id ?? null,
        selectedSkillId: row?.selected_skill_id ?? null,
        selectedSkillMode: row?.selected_skill_mode ?? "auto",
    };
}

async function handleSkillSettings(
    request: StorageRequest,
    db: D1Database,
    userId: string,
): Promise<unknown> {
    if (request.op === "skillSettings.get") {
        return await getSkillSettings(db, userId);
    }
    if (request.op !== "skillSettings.put") {
        throw new Error("Unsupported storage operation");
    }
    const current = await getSkillSettings(db, userId);
    const settings: SkillSettings = {
        ...current,
        ...(request.settings ?? {}),
    };
    await db
        .prepare(
            "INSERT INTO skill_settings (user_id, default_skill_id, selected_skill_id, selected_skill_mode) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET default_skill_id = excluded.default_skill_id, selected_skill_id = excluded.selected_skill_id, selected_skill_mode = excluded.selected_skill_mode",
        )
        .bind(
            userId,
            settings.defaultSkillId,
            settings.selectedSkillId,
            settings.selectedSkillMode,
        )
        .run();
    return null;
}

async function handleStorageRequest(
    request: StorageRequest,
    db: D1Database,
    bucket: R2Bucket | undefined,
    userId: string,
): Promise<unknown> {
    switch (request.op?.split(".")[0]) {
        case "chats":
            return await handleChats(request, db, bucket, userId);
        case "messages":
            return await handleMessages(request, db, bucket, userId);
        case "attachments":
            return await handleAttachments(request, db, bucket, userId);
        case "skills":
            return await handleSkills(request, db, userId);
        case "skillSettings":
            return await handleSkillSettings(request, db, userId);
        case "usage":
            return await handleUsage(db, userId);
        default:
            throw new Error("Unsupported storage operation");
    }
}

export async function POST(request: Request) {
    const bindings = await getCloudflareBindings();
    if (!bindings.DB) {
        return json({ error: "Cloudflare D1 is not configured" }, 503);
    }

    const identity = await authenticateCloudflareAccess(request, bindings);
    if (!identity) return json({ error: "Authentication required" }, 401);

    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_REQUEST_BYTES) {
        return json({ error: "Request exceeds the 16 MiB limit" }, 413);
    }

    let body: StorageRequest;
    try {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
            return json({ error: "Request exceeds the 16 MiB limit" }, 413);
        }
        body = JSON.parse(text) as StorageRequest;
    } catch {
        return json({ error: "Invalid JSON request" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ error: "Invalid storage request" }, 400);
    }

    try {
        const result = await handleStorageRequest(
            body,
            bindings.DB,
            bindings.ATTACHMENTS,
            identity.userId,
        );
        return json({ result });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Storage operation failed";
        const status = message.includes("not found")
            ? 404
            : message.includes("limit")
              ? 413
              : message.includes("unavailable")
                ? 503
                : message.startsWith("Invalid ") ||
                    message.startsWith("Unsupported ")
                  ? 400
                  : 500;
        return json({ error: message }, status);
    }
}
