export interface D1Result<T> {
    results: T[];
    success: boolean;
    meta?: { changes?: number };
}

export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    run(): Promise<D1Result<never>>;
}

export interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

export interface R2ObjectBody {
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Bucket {
    put(
        key: string,
        value: ArrayBuffer | ArrayBufferView,
        options?: { httpMetadata?: { contentType?: string } },
    ): Promise<unknown>;
    get(key: string): Promise<R2ObjectBody | null>;
    delete(key: string): Promise<void>;
}

export interface CloudflareBindings {
    DB?: D1Database;
    ATTACHMENTS?: R2Bucket;
    CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string;
    CLOUDFLARE_ACCESS_AUD?: string;
}
