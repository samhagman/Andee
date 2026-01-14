/**
 * Handler exports for all endpoints.
 */

export { handleHealth } from "./health";
export { handleAsk } from "./ask";
export { handleDiag } from "./diag";
export { handleLogs } from "./logs";
export { handleRestart } from "./restart";
export { handleFactoryReset } from "./factory-reset";
export { handleSessionUpdate } from "./sessionUpdate";
export {
  handleSnapshotCreate,
  handleSnapshotGet,
  handleSnapshotsList,
  handleSnapshotRestore,
} from "./snapshot";
export {
  handleSnapshotFiles,
  handleSnapshotFile,
} from "./snapshot-preview";
export {
  handleScheduleReminder,
  handleCancelReminder,
  handleCompleteReminder,
  handleListReminders,
} from "./reminder";
export {
  handleSandboxes,
  handleFiles,
  handleFileRead,
  handleFileWrite,
  handleTerminal,
  handleTerminalUrl,
  handleWsContainerTest,
  clearTerminalUrlCache,
  clearAllTerminalUrlCaches,
} from "./ide";
