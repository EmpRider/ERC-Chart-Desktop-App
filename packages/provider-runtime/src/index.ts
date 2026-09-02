import { assertPluginPackageContentPolicy } from "./package-policy.js";
import {
  assertPluginPackageTrust,
  type PluginTrustPolicy,
} from "./plugin-trust.js";
import {
  defaultPluginPackageLimits,
  discardStagedPlugin,
  stagePluginPackage as stagePluginPackageBase,
  type PluginPackageLimits,
  type PluginPackageSource,
  type PluginStagingOptions,
  type StagedPluginFile,
  type StagedPluginPackage,
} from "./plugin-staging.js";

export interface PluginPackageInstallOptions extends PluginStagingOptions {
  readonly trustPolicy: PluginTrustPolicy;
}

export {
  assertPluginPackageTrust,
  createPluginSignaturePayload,
} from "./plugin-trust.js";
export type {
  PluginTrustMode,
  PluginTrustPolicy,
  PluginTrustResult,
} from "./plugin-trust.js";
export { defaultPluginPackageLimits, discardStagedPlugin };
export {
  installStagedPlugin,
  removeInstalledPlugin,
} from "./plugin-installation.js";
export type {
  InstalledPluginPackage,
  PluginInstallationOptions,
} from "./plugin-installation.js";

export async function stagePluginPackage(
  source: PluginPackageSource,
  options: PluginPackageInstallOptions,
): Promise<StagedPluginPackage> {
  const staged = await stagePluginPackageBase(source, options);
  try {
    assertPluginPackageContentPolicy(staged.files);
    assertPluginPackageTrust(staged, options.trustPolicy);
    return staged;
  } catch (error) {
    await discardStagedPlugin(staged);
    throw error;
  }
}

export type {
  PluginPackageLimits,
  PluginPackageSource,
  PluginStagingOptions,
  StagedPluginFile,
  StagedPluginPackage,
};
export { createProviderUtilityRuntime } from "./utility-runtime.js";
export type {
  ProviderUtilityPort,
  ProviderUtilityRuntime,
} from "./utility-runtime.js";
export { createProviderUtilitySupervisor } from "./provider-supervisor.js";
export type {
  ProviderUtilityChild,
  ProviderUtilityScheduler,
  ProviderUtilitySupervisor,
  ProviderUtilitySupervisorOptions,
  ProviderUtilitySupervisorStatus,
  ProviderUtilityUnavailableCode,
} from "./provider-supervisor.js";
export {
  instantiateInstalledProvider,
  normalizeProviderConfiguration,
  ProviderRuntimeError,
} from "./provider-instance.js";
export type {
  InstalledProviderInstance,
  InstalledProviderInstanceOptions,
  ProviderRuntimeErrorCode,
  ProviderRuntimeHostBroker,
} from "./provider-instance.js";
export {
  isProviderUtilityChildMessage,
  isProviderUtilityParentMessage,
} from "./provider-protocol.js";
export type {
  ProviderUtilityChildMessage,
  ProviderUtilityCredentialRequestMessage,
  ProviderUtilityHostResponseMessage,
  ProviderUtilityInitializeMessage,
  ProviderUtilityLaunchDescriptor,
  ProviderUtilityLogMessage,
  ProviderUtilityNetworkRequestMessage,
  ProviderUtilityParentMessage,
  ProviderUtilityProviderStatusMessage,
} from "./provider-protocol.js";
