/**
 * Streaming utilities for large file transfers between sandbox and R2.
 *
 * Solves the 32MB RPC limit by splitting files into chunks on the container,
 * then reading each chunk individually and uploading via R2 multipart upload.
 */

import { Sandbox } from "@cloudflare/sandbox";
import { debug } from "./debug";

// R2 multipart minimum chunk size is 5MB (except last part)
export const MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// Threshold for using streaming vs buffered approach
// Under this, regular readFile is fine; over this, use streaming
export const STREAMING_THRESHOLD = 25 * 1024 * 1024; // 25MB

// Temp paths for chunked operations
const CHUNK_PREFIX = "/tmp/snapshot_chunk_";

/**
 * Get the size of a file in the sandbox.
 */
export async function getFileSize(
  sandbox: Sandbox,
  path: string
): Promise<number> {
  const result = await sandbox.exec(`stat -c %s "${path}"`, { timeout: 5000 });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to get file size: ${result.stderr}`);
  }
  return parseInt(result.stdout.trim(), 10);
}

/**
 * Split a file into chunks on the container.
 * Returns the list of chunk file paths.
 */
export async function splitFileIntoChunks(
  sandbox: Sandbox,
  sourcePath: string,
  chunkSize: number = MULTIPART_CHUNK_SIZE,
  chatId?: string
): Promise<string[]> {
  debug.snapshot('split-start', chatId || 'unknown', { sourcePath, chunkSize });

  // Clean up any existing chunks first
  await sandbox.exec(`rm -f ${CHUNK_PREFIX}*`, { timeout: 5000 });

  // Split the file
  const splitResult = await sandbox.exec(
    `split -b ${chunkSize} "${sourcePath}" "${CHUNK_PREFIX}"`,
    { timeout: 120_000 } // 2 minutes for large files
  );

  if (splitResult.exitCode !== 0) {
    throw new Error(`Failed to split file: ${splitResult.stderr}`);
  }

  // List the chunks (sorted for correct order)
  const listResult = await sandbox.exec(
    `ls -1 ${CHUNK_PREFIX}* 2>/dev/null | sort`,
    { timeout: 5000 }
  );

  if (listResult.exitCode !== 0 || !listResult.stdout.trim()) {
    throw new Error("No chunks created after split");
  }

  const chunks = listResult.stdout.trim().split('\n').filter(Boolean);
  debug.snapshot('split-complete', chatId || 'unknown', { chunkCount: chunks.length });

  return chunks;
}

/**
 * Clean up chunk files from the container.
 */
export async function cleanupChunks(sandbox: Sandbox): Promise<void> {
  await sandbox.exec(`rm -f ${CHUNK_PREFIX}*`, { timeout: 5000 });
}

/**
 * Read a chunk file and decode from base64 to Uint8Array.
 * Each chunk is ~5MB binary = ~6.67MB base64, well under 32MB RPC limit.
 */
export async function readChunkAsBinary(
  sandbox: Sandbox,
  chunkPath: string
): Promise<Uint8Array> {
  const chunkData = await sandbox.readFile(chunkPath, { encoding: "base64" });

  if (!chunkData.content) {
    throw new Error(`Empty chunk file: ${chunkPath}`);
  }

  // Decode base64 to binary
  const binaryString = atob(chunkData.content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

/**
 * Upload a large file to R2 using multipart upload.
 *
 * Process:
 * 1. Split file into chunks on container
 * 2. Read each chunk via readFile (under 32MB RPC limit)
 * 3. Upload each chunk as multipart part
 * 4. Complete multipart upload
 */
export async function uploadLargeFileToR2(
  sandbox: Sandbox,
  sourcePath: string,
  r2Bucket: R2Bucket,
  r2Key: string,
  metadata: Record<string, string>,
  chatId?: string
): Promise<{ size: number; parts: number }> {
  const timer = debug.timer('Streaming', 'uploadLargeFileToR2', { chatId, r2Key });

  // Get file size
  const fileSize = await getFileSize(sandbox, sourcePath);
  debug.snapshot('upload-start', chatId || 'unknown', { fileSize, r2Key });

  // Split into chunks
  const chunkPaths = await splitFileIntoChunks(sandbox, sourcePath, MULTIPART_CHUNK_SIZE, chatId);

  // Initialize multipart upload
  const multipart = await r2Bucket.createMultipartUpload(r2Key, {
    customMetadata: metadata,
  });

  const parts: R2UploadedPart[] = [];

  try {
    // Upload each chunk
    for (let i = 0; i < chunkPaths.length; i++) {
      const chunkPath = chunkPaths[i];
      const partNumber = i + 1;

      debug.snapshot('upload-part-start', chatId || 'unknown', {
        partNumber,
        totalParts: chunkPaths.length,
        chunkPath
      });

      // Read chunk as binary
      const chunkData = await readChunkAsBinary(sandbox, chunkPath);

      // Upload to R2
      const uploaded = await multipart.uploadPart(partNumber, chunkData);
      parts.push(uploaded);

      debug.snapshot('upload-part-complete', chatId || 'unknown', {
        partNumber,
        chunkSize: chunkData.length
      });
    }

    // Complete multipart upload
    await multipart.complete(parts);

    debug.snapshot('upload-complete', chatId || 'unknown', {
      totalSize: fileSize,
      partCount: parts.length
    });

    timer({ success: true, size: fileSize, parts: parts.length });

    return { size: fileSize, parts: parts.length };

  } catch (error) {
    // Abort multipart on failure
    debug.error('upload-failed', {
      component: 'Streaming',
      chatId,
      error: String(error),
      partsUploaded: parts.length
    });

    try {
      await multipart.abort();
    } catch (abortError) {
      debug.warn('abort-failed', { component: 'Streaming', error: String(abortError) });
    }

    throw error;

  } finally {
    // Always clean up chunks
    await cleanupChunks(sandbox);
  }
}

/**
 * Download a large file from R2 and write to container in chunks.
 *
 * @deprecated Prefer using presigned URLs with curl for new code.
 * See container-startup.ts:restoreFromSnapshot() for the better approach
 * that bypasses Worker memory entirely.
 *
 * This function is kept for IDE and /restore endpoints that haven't been
 * migrated yet.
 *
 * Process:
 * 1. Stream R2 object body
 * 2. Accumulate chunks until 5MB
 * 3. Write each 5MB chunk to container via writeFile
 * 4. Concatenate chunks on container
 */
export async function downloadLargeFileFromR2(
  sandbox: Sandbox,
  r2Object: R2ObjectBody,
  destPath: string,
  chatId?: string
): Promise<{ size: number; chunks: number }> {
  const timer = debug.timer('Streaming', 'downloadLargeFileFromR2', { chatId, destPath });

  const fileSize = r2Object.size;
  debug.snapshot('download-start', chatId || 'unknown', { fileSize, destPath });

  // Clean up any existing chunks
  await sandbox.exec(`rm -f ${CHUNK_PREFIX}* "${destPath}"`, { timeout: 5000 });

  const reader = r2Object.body.getReader();
  let buffer = new Uint8Array(0);
  let chunkIndex = 0;
  const chunkPaths: string[] = [];

  // Helper to concat Uint8Arrays
  const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const result = new Uint8Array(a.length + b.length);
    result.set(a, 0);
    result.set(b, a.length);
    return result;
  };

  // Helper to write a chunk to container
  const writeChunk = async (data: Uint8Array): Promise<string> => {
    const chunkPath = `${CHUNK_PREFIX}${String(chunkIndex).padStart(4, '0')}`;
    chunkIndex++;

    // Encode to base64 in chunks to avoid stack overflow
    const ENCODE_CHUNK_SIZE = 32768;
    let binaryString = '';
    for (let i = 0; i < data.length; i += ENCODE_CHUNK_SIZE) {
      const chunk = data.subarray(i, Math.min(i + ENCODE_CHUNK_SIZE, data.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64 = btoa(binaryString);

    await sandbox.writeFile(chunkPath, base64, { encoding: 'base64' });
    chunkPaths.push(chunkPath);

    debug.snapshot('download-chunk-written', chatId || 'unknown', {
      chunkPath,
      size: data.length
    });

    return chunkPath;
  };

  try {
    // Read and write chunks
    while (true) {
      const { done, value } = await reader.read();

      if (value) {
        buffer = concat(buffer, value);
      }

      // Write complete chunks
      while (buffer.length >= MULTIPART_CHUNK_SIZE) {
        const chunk = buffer.slice(0, MULTIPART_CHUNK_SIZE);
        buffer = buffer.slice(MULTIPART_CHUNK_SIZE);
        await writeChunk(chunk);
      }

      if (done) break;
    }

    // Write remaining data
    if (buffer.length > 0) {
      await writeChunk(buffer);
    }

    // Concatenate all chunks into destination file
    if (chunkPaths.length > 0) {
      const catResult = await sandbox.exec(
        `cat ${chunkPaths.join(' ')} > "${destPath}"`,
        { timeout: 120_000 }
      );

      if (catResult.exitCode !== 0) {
        throw new Error(`Failed to concatenate chunks: ${catResult.stderr}`);
      }
    }

    debug.snapshot('download-complete', chatId || 'unknown', {
      totalSize: fileSize,
      chunkCount: chunkPaths.length
    });

    timer({ success: true, size: fileSize, chunks: chunkPaths.length });

    return { size: fileSize, chunks: chunkPaths.length };

  } finally {
    // Clean up chunks
    await cleanupChunks(sandbox);
  }
}
