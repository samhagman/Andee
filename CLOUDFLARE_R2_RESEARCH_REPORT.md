# Cloudflare R2 Research Report

> **Purpose**: Condensed reference for persistent storage in Cloudflare Workers and Sandbox
> **Docs**: https://developers.cloudflare.com/r2/

---

## Quick Start

```bash
# Create R2 bucket via dashboard or CLI
npx wrangler r2 bucket create my-bucket

# Add to wrangler.toml
```

---

## Configuration

### wrangler.toml
```toml
[[r2_buckets]]
binding = "MY_BUCKET"        # Variable name in Worker
bucket_name = "my-bucket"    # Actual bucket name
preview_bucket_name = "my-bucket-dev"  # Optional: for wrangler dev
```

### TypeScript Types
```typescript
interface Env {
  MY_BUCKET: R2Bucket;
}
```

---

## Core API

### Put (Write)
```typescript
// Simple put
await env.MY_BUCKET.put("key", "value");

// With options
await env.MY_BUCKET.put("sessions/123.json", JSON.stringify(data), {
  httpMetadata: {
    contentType: "application/json"
  },
  customMetadata: {
    userId: "123",
    createdAt: new Date().toISOString()
  }
});

// From stream
await env.MY_BUCKET.put("large-file", request.body);
```

### Get (Read)
```typescript
// Get object
const obj = await env.MY_BUCKET.get("key");
if (obj === null) {
  // Object doesn't exist
}

// Read as different types
const text = await obj.text();
const json = await obj.json();
const buffer = await obj.arrayBuffer();
const blob = await obj.blob();

// Streaming
const stream = obj.body;  // ReadableStream

// Access metadata
console.log(obj.key);
console.log(obj.size);
console.log(obj.etag);
console.log(obj.uploaded);  // Date
console.log(obj.httpMetadata);
console.log(obj.customMetadata);
```

### Head (Metadata Only)
```typescript
const obj = await env.MY_BUCKET.head("key");
if (obj === null) {
  // Doesn't exist
}
// obj has metadata but no body
console.log(obj.size, obj.etag);
```

### Delete
```typescript
// Single delete
await env.MY_BUCKET.delete("key");

// Batch delete (up to 1000)
await env.MY_BUCKET.delete(["key1", "key2", "key3"]);
```

### List
```typescript
// List all
const listed = await env.MY_BUCKET.list();
for (const obj of listed.objects) {
  console.log(obj.key, obj.size);
}

// With prefix (like folders)
const listed = await env.MY_BUCKET.list({
  prefix: "sessions/"
});

// Pagination
let cursor: string | undefined;
do {
  const listed = await env.MY_BUCKET.list({
    prefix: "logs/",
    limit: 100,
    cursor
  });

  for (const obj of listed.objects) {
    console.log(obj.key);
  }

  cursor = listed.truncated ? listed.cursor : undefined;
} while (cursor);

// Delimiter for "folder" behavior
const listed = await env.MY_BUCKET.list({
  prefix: "data/",
  delimiter: "/"
});
// listed.delimitedPrefixes contains "folder" names
```

---

## R2 Types Reference

### R2Bucket
```typescript
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(key: string, value: ReadableStream | ArrayBuffer | string | Blob,
      options?: R2PutOptions): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
  createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}
```

### R2Object (Metadata)
```typescript
interface R2Object {
  key: string;
  version: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
  storageClass: "Standard" | "InfrequentAccess";
  checksums?: R2Checksums;
}
```

### R2ObjectBody (With Content)
```typescript
interface R2ObjectBody extends R2Object {
  body: ReadableStream;
  bodyUsed: boolean;

  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}
```

### R2PutOptions
```typescript
interface R2PutOptions {
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
    cacheExpiry?: Date;
  };
  customMetadata?: Record<string, string>;
  md5?: ArrayBuffer | string;
  sha1?: ArrayBuffer | string;
  sha256?: ArrayBuffer | string;
  storageClass?: "Standard" | "InfrequentAccess";
}
```

### R2GetOptions
```typescript
interface R2GetOptions {
  range?: {
    offset?: number;
    length?: number;
    suffix?: number;  // Last N bytes
  };
  onlyIf?: R2Conditional;  // Conditional get
}
```

### R2ListOptions
```typescript
interface R2ListOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;  // Max 1000
  include?: ("httpMetadata" | "customMetadata")[];
}
```

---

## Session Storage Pattern for Telegram Bot

### Session Storage Adapter
```typescript
interface SessionData {
  claudeSessionId: string | null;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

class R2SessionStorage {
  constructor(private bucket: R2Bucket) {}

  private key(chatId: string): string {
    return `sessions/${chatId}.json`;
  }

  async get(chatId: string): Promise<SessionData | null> {
    const obj = await this.bucket.get(this.key(chatId));
    if (!obj) return null;
    return obj.json<SessionData>();
  }

  async set(chatId: string, data: SessionData): Promise<void> {
    await this.bucket.put(
      this.key(chatId),
      JSON.stringify(data),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          chatId,
          updatedAt: new Date().toISOString()
        }
      }
    );
  }

  async delete(chatId: string): Promise<void> {
    await this.bucket.delete(this.key(chatId));
  }

  async listSessions(): Promise<string[]> {
    const listed = await this.bucket.list({ prefix: "sessions/" });
    return listed.objects.map(obj =>
      obj.key.replace("sessions/", "").replace(".json", "")
    );
  }
}
```

### Usage in Worker
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const storage = new R2SessionStorage(env.SESSIONS_BUCKET);

    const chatId = "12345";

    // Load session
    let session = await storage.get(chatId);
    if (!session) {
      session = {
        claudeSessionId: null,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0
      };
    }

    // Update session
    session.lastActivity = Date.now();
    session.messageCount++;

    // Save session
    await storage.set(chatId, session);

    return new Response("OK");
  }
};
```

---

## R2 in Sandbox (Bucket Mounting)

### Mount R2 as Filesystem
```typescript
import { getSandbox } from "@cloudflare/sandbox";

const sandbox = getSandbox(env.Sandbox, "my-sandbox");

// Mount bucket to /data path
await sandbox.mountBucket("my-bucket", "/data", {
  endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
});

// Now use filesystem operations!
await sandbox.writeFile("/data/file.txt", "Hello R2!");
const result = await sandbox.exec("cat /data/file.txt");
// Data persists even after sandbox.destroy()
```

### Getting Account ID
```bash
# From Cloudflare dashboard, or:
npx wrangler whoami
```

### Setting Up R2 API Credentials

1. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens
2. Create API token with Object Read & Write permissions
3. Set as Worker secrets:

```bash
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

---

## Multipart Uploads (Large Files)

```typescript
// Start multipart upload
const upload = await env.MY_BUCKET.createMultipartUpload("large-file.zip");

// Upload parts (minimum 5MB each, except last)
const parts: R2UploadedPart[] = [];
let partNumber = 1;

for await (const chunk of largeDataStream) {
  const part = await upload.uploadPart(partNumber, chunk);
  parts.push(part);
  partNumber++;
}

// Complete upload
await upload.complete(parts);

// Or abort if something goes wrong
await upload.abort();
```

---

## Conditional Operations

```typescript
// Only get if etag matches (caching)
const obj = await env.MY_BUCKET.get("key", {
  onlyIf: { etagMatches: "known-etag" }
});

// Only put if doesn't exist
const result = await env.MY_BUCKET.put("key", "value", {
  onlyIf: { etagDoesNotMatch: "*" }  // Fails if exists
});
```

---

## Best Practices

1. **Use prefixes as folders**: `sessions/123.json`, `logs/2024/01/file.log`
2. **Set content types**: Always set `httpMetadata.contentType` for JSON
3. **Batch deletes**: Use array delete for cleanup (up to 1000 keys)
4. **Pagination**: Always handle `truncated` for list operations
5. **Conditional writes**: Use etags to prevent race conditions
6. **Custom metadata**: Store searchable info without reading full object

---

## Local Development

R2 binding works with `wrangler dev`, but has limitations:
- Uses local file-based storage
- Not connected to production bucket
- Use `preview_bucket_name` for isolation

```toml
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "prod-bucket"
preview_bucket_name = "dev-bucket"
```

---

## Cost Considerations

| Operation | Cost |
|-----------|------|
| Class A (PUT, POST, LIST) | $4.50 per million |
| Class B (GET, HEAD) | $0.36 per million |
| Storage | $0.015 per GB/month |
| Egress | Free! |

---

## Quick Reference Links

- Overview: https://developers.cloudflare.com/r2/
- Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Create Buckets: https://developers.cloudflare.com/r2/buckets/create-buckets/
- API Tokens: https://developers.cloudflare.com/r2/api/s3/tokens/
