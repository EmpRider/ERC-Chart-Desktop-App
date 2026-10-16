import type { DataUtilityClient } from "@erc-chart/electron-main";
import type {
  CreateProviderProfileInput,
  PluginRegistryEntry,
  ProviderProfile,
  UpdateProviderProfileInput,
} from "@erc-chart/storage";

export interface DataUtilityStorage {
  readonly listProviderProfiles: () => Promise<readonly ProviderProfile[]>;
  readonly getProviderProfile: (
    id: string,
  ) => Promise<ProviderProfile | undefined>;
  readonly createProviderProfile: (
    input: CreateProviderProfileInput,
  ) => Promise<ProviderProfile>;
  readonly updateProviderProfile: (
    id: string,
    input: UpdateProviderProfileInput,
  ) => Promise<ProviderProfile>;
  readonly deleteProviderProfile: (id: string) => Promise<boolean>;
  readonly listPlugins: () => Promise<readonly PluginRegistryEntry[]>;
  readonly putPlugin: (
    input: PluginRegistryEntry,
  ) => Promise<PluginRegistryEntry>;
  readonly activatePlugin: (
    pluginId: string,
    version: string,
  ) => Promise<PluginRegistryEntry>;
  readonly disablePlugin: (
    pluginId: string,
    version: string,
  ) => Promise<PluginRegistryEntry>;
  readonly deletePlugin: (
    pluginId: string,
    version: string,
  ) => Promise<boolean>;
}

type DataUtilityRequester = Pick<DataUtilityClient, "request">;

export function createDataUtilityStorage(
  client: DataUtilityRequester,
): DataUtilityStorage {
  return {
    listProviderProfiles: (): Promise<readonly ProviderProfile[]> =>
      client.request("profile-list", null),
    getProviderProfile: async (id): Promise<ProviderProfile | undefined> =>
      (await client.request<ProviderProfile | null>("profile-get", {
        profileId: id,
      })) ?? undefined,
    createProviderProfile: (input): Promise<ProviderProfile> =>
      client.request("profile-create", input),
    updateProviderProfile: (id, input): Promise<ProviderProfile> =>
      client.request("profile-update", { profileId: id, update: input }),
    deleteProviderProfile: (id): Promise<boolean> =>
      client.request("profile-delete", { profileId: id }),
    listPlugins: (): Promise<readonly PluginRegistryEntry[]> =>
      client.request("plugin-list", null),
    putPlugin: (input): Promise<PluginRegistryEntry> =>
      client.request("plugin-put", input),
    activatePlugin: (pluginId, version): Promise<PluginRegistryEntry> =>
      client.request("plugin-activate", { pluginId, version }),
    disablePlugin: (pluginId, version): Promise<PluginRegistryEntry> =>
      client.request("plugin-disable", { pluginId, version }),
    deletePlugin: (pluginId, version): Promise<boolean> =>
      client.request("plugin-delete", { pluginId, version }),
  };
}
