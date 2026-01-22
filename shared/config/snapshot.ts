/**
 * Snapshot configuration constants.
 * Centralized to ensure consistency across all snapshot/restore operations.
 */

// ============================================================================
// Snapshot Directories
// ============================================================================

/**
 * Directories included in snapshots (tar creation).
 * These are the top-level directories we back up.
 */
export const SNAPSHOT_DIRS = ["/workspace", "/home/claude"] as const;

/**
 * Temporary path for snapshot files during create/restore operations.
 */
export const SNAPSHOT_TMP_PATH = "/tmp/snapshot.tar.gz";

/**
 * Timeout for tar create/extract operations (60 seconds).
 */
export const TAR_TIMEOUT_MS = 60_000;

// ============================================================================
// Snapshot Exclusions (CREATE time)
// ============================================================================

/**
 * Paths to exclude when CREATING snapshots.
 * These are large caches or R2-mounted paths that are handled separately.
 */
export const SNAPSHOT_CREATE_EXCLUDES = [
  "/media",                       // R2-mounted bucket (persisted separately)
  "/media/*",
  "/home/claude/.memvid",         // Legacy: embedding models (~133MB)
  "/home/claude/shared/*.mv2",    // Legacy: shared conversation memory
] as const;

// ============================================================================
// Restore Exclusions (RESTORE time) - KEY FOR USER/SYSTEM SEPARATION
// ============================================================================

/**
 * System paths to exclude when RESTORING snapshots.
 * These paths should always come fresh from the Dockerfile.
 * User data in the snapshot is preserved; system data is skipped.
 *
 * WHY AT RESTORE TIME:
 * - Backward compatible with old snapshots (they contain everything)
 * - Fresh container already has Dockerfile versions of these files
 * - Restore simply doesn't overwrite them
 *
 * NOTE: Paths are RELATIVE (no leading /) for tar extraction.
 */
export const SNAPSHOT_RESTORE_EXCLUDES = [
  // Skills directory (baked into Dockerfile)
  "home/claude/.claude/skills",
  "home/claude/.claude/skills/*",

  // Settings file (baked into Dockerfile)
  "home/claude/.claude/settings.json",

  // Helper scripts (baked into Dockerfile)
  "home/claude/.claude/scripts",
  "home/claude/.claude/scripts/*",

  // Personality/instructions (baked into Dockerfile)
  "home/claude/CLAUDE.md",

  // Workspace project instructions (baked into Dockerfile)
  "workspace/CLAUDE.md",
] as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build tar --exclude flags for snapshot CREATION.
 * Used when creating new snapshots.
 */
export function buildCreateExcludeFlags(): string {
  return SNAPSHOT_CREATE_EXCLUDES.map((p) => `--exclude='${p}'`).join(" ");
}

/**
 * Build tar --exclude flags for snapshot RESTORE.
 * Used when restoring snapshots to exclude system files.
 * This ensures Dockerfile-provided system files are preserved.
 */
export function buildRestoreExcludeFlags(): string {
  return SNAPSHOT_RESTORE_EXCLUDES.map((p) => `--exclude='${p}'`).join(" ");
}
