import { assertPluginPackageContentPolicy } from "./package-policy.js";
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

export { defaultPluginPackageLimits, discardStagedPlugin };

export async function stagePluginPackage(
  source: PluginPackageSource,
  options: PluginStagingOptions,
): Promise<StagedPluginPackage> {
  const staged = await stagePluginPackageBase(source, options);
  try {
    assertPluginPackageContentPolicy(staged.files);
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
