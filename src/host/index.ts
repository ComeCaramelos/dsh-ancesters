/**
 * @comecaramelos/dsh-ancesters — host plane public surface.
 *
 * Members of this list are public contract with semver: what is not re-exported
 * here stays an implementation detail behind `lib/*`. The surface stays small on
 * purpose; the mechanisms behind it land in the later phases.
 */
export { requireEntryId, rowConfigKey } from "./identity.js";
export type { EntryIdSource } from "./identity.js";

export {
    NAME_MAX_LENGTH,
    ENTRY_CAP,
    ID_MAX_LENGTH,
    isValidEntryId,
    entryLabel,
    normalizeEntries,
    mergeEntries,
    entryIds,
    findEntry
} from "./catalog.js";
export type { CatalogRow, CatalogRules } from "./catalog.js";

export {
    CONTROL_PATTERN,
    validateExtraFlags,
    carriesConnectionMode,
    flagsSkipCheck,
    sameFlags
} from "./flags.js";
export type { ExtraFlags, FlagsRules } from "./flags.js";

export { isWindowsSubsystemForLinux, isWindowsExecutablePath, isWindowsExecutableUnderWsl } from "./platform.js";
export type { PlatformProbe } from "./platform.js";

export { firstLine, isExecutableMissing, toolResultNote, ERROR_CAP } from "./status.js";
export type { ErrorRules, ToolResultLike } from "./status.js";

export { stderrLogPath, buildSpawn, STDERR_WRAPPER_PATH } from "./stderr.js";
export type { SpawnTarget, SpawnResult, StderrMode, StderrOptions } from "./stderr.js";

// --- Phase 2: the Settings mechanism (host/adapter) -----------------------
export {
    supportsSettingsForms,
    requireSettingsForms,
    VOLATILE_UPDATE_EVENT,
    TOOL_POST_EXECUTE_EVENT,
    logPrefix,
    readVolatile
} from "./adapter/dsh.js";
export type { AdapterContext, EntryLike, FiberLike, SettingsDocument, SettingsForms, SettingsPathOp } from "./adapter/dsh.js";
export { FIBER_ACTIVE } from "./adapter/dsh.js";

export { attachSettingsForm, readFormRow, routesUserCommit } from "./adapter/form.js";
export type { SettingsFormSpec, SettingsFormHandle, FormCommit } from "./adapter/form.js";

export { createLiveMirror } from "./adapter/live.js";
export type { LiveMirror, LiveMirrorOptions } from "./adapter/live.js";

export { createPersister } from "./adapter/persist.js";
export type { PersistUser, PersisterOptions, UserFields } from "./adapter/persist.js";

export { createRunChain } from "./runs.js";
export type { RunChain } from "./runs.js";

export { captureBridgeLog, captureToolResults, formatLogArgs, matchesToolName } from "./captures.js";
export type { LogLine, ToolCaptureMatch, ToolCaptureOptions, ToolResultEvent } from "./captures.js";

export { sameValue, stableKey } from "./values.js";

export { createFiberPool } from "./pool.js";
export type { FiberPool, FiberPoolSpec, PoolFiber, PoolLine, ResolvedEntry } from "./pool.js";

export { createGlobalRegistry } from "./registry.js";
export type { GlobalRegistry, RegistryAnswer } from "./registry.js";

export { toolNamesByNamespace, toolNamespaceOf } from "./adapter/tools.js";
