import nodeProcess from "node:process";
import type { DatabaseSync } from "node:sqlite";
import {
  dataUtilityUpstreamTimeoutMs,
  ipcContractVersion,
  isDataUtilityCommand,
  isDataUtilityInitMessage,
  isDataUtilityUpstreamEvent,
  isDataUtilityUpstreamResult,
  isProviderHistoryLoadRequest,
  isProviderLiveSubscriptionRequest,
  isUtilityControlMessage,
  type DataUtilityCommand,
  type DataUtilityUpstreamRequest,
  type PersistedWorkspace,
} from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";
import {
  activatePlugin,
  claimWorkspace,
  createProviderProfile,
  deletePlugin,
  deleteProviderProfile,
  disablePlugin,
  getProviderProfile,
  listPlugins,
  listProviderProfiles,
  loadLatestWorkspaceSession,
  loadWorkspace,
  openStorageDatabase,
  putPlugin,
  saveWorkspace,
  updateProviderProfile,
  type CreateProviderProfileInput,
  type PluginRegistryEntry,
  type UpdateProviderProfileInput,
} from "@erc-chart/storage";
import {
  createProviderDataService,
  type ProviderDataService,
  type ProviderDataServiceSink,
  type ProviderDataUpstream,
} from "./provider-bridge.js";

export interface UtilityPort {
  readonly postMessage: (message: unknown) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
}

export interface UtilityRuntime {
  readonly shutdown: () => Promise<void>;
}

interface UtilityState {
  readonly generation: number;
  readonly database: DatabaseSync;
  readonly instanceId: string;
  readonly legacyWorkspaceId: string;
  readonly service: ProviderDataService;
}

interface PendingUpstream {
  readonly timer: unknown;
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface UpstreamLiveSink {
  readonly sink: ProviderDataSink;
  readonly generation: number;
}

const maximumPendingRequests = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const expected = new Set(fields);
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => expected.has(field) && field in value)
  );
}

function requireProfilePayload(payload: unknown): string {
  if (
    !isRecord(payload) ||
    !exactFields(payload, ["profileId"]) ||
    typeof payload.profileId !== "string" ||
    payload.profileId.length === 0 ||
    payload.profileId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/u.test(payload.profileId)
  ) {
    throw new Error("Provider profile request is invalid.");
  }
  return payload.profileId;
}

function requireHistoryPayload(payload: unknown): {
  readonly profileId: string;
  readonly request: ProviderHistoryRequest;
} {
  if (!isProviderHistoryLoadRequest(payload))
    throw new Error("Provider history request is invalid.");
  return {
    profileId: payload.profileId,
    request: {
      instrumentId:
        payload.instrumentId as ProviderHistoryRequest["instrumentId"],
      timeframeId: payload.timeframeId as ProviderHistoryRequest["timeframeId"],
      ...(payload.fromMs === undefined ? {} : { fromMs: payload.fromMs }),
      ...(payload.toMs === undefined ? {} : { toMs: payload.toMs }),
      ...(payload.limit === undefined ? {} : { limit: payload.limit }),
    },
  };
}

function requireLivePayload(payload: unknown): {
  readonly profileId: string;
  readonly subscriptionId: string;
  readonly request: ProviderSubscriptionRequest;
} {
  if (!isProviderLiveSubscriptionRequest(payload))
    throw new Error("Provider live subscription request is invalid.");
  return {
    profileId: payload.profileId,
    subscriptionId: payload.subscriptionId,
    request: {
      instrumentId:
        payload.instrumentId as ProviderSubscriptionRequest["instrumentId"],
      timeframeId:
        payload.timeframeId as ProviderSubscriptionRequest["timeframeId"],
    },
  };
}

function requireSubscriptionId(payload: unknown): string {
  if (
    !isRecord(payload) ||
    !exactFields(payload, ["subscriptionId"]) ||
    typeof payload.subscriptionId !== "string" ||
    payload.subscriptionId.length === 0 ||
    payload.subscriptionId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/u.test(payload.subscriptionId)
  ) {
    throw new Error("Provider subscription ID is invalid.");
  }
  return payload.subscriptionId;
}

function requireWorkspace(payload: unknown): PersistedWorkspace {
  if (!isRecord(payload) || payload.schemaVersion !== 1)
    throw new Error("Workspace request is invalid.");
  return payload as unknown as PersistedWorkspace;
}

function requireProviderProfileCreate(
  payload: unknown,
): CreateProviderProfileInput {
  if (!isRecord(payload))
    throw new Error("Provider profile create request is invalid.");
  return payload as unknown as CreateProviderProfileInput;
}

function requireProviderProfileUpdate(payload: unknown): {
  readonly profileId: string;
  readonly update: UpdateProviderProfileInput;
} {
  if (
    !isRecord(payload) ||
    typeof payload.profileId !== "string" ||
    !isRecord(payload.update)
  ) {
    throw new Error("Provider profile update request is invalid.");
  }
  return {
    profileId: payload.profileId,
    update: payload.update as UpdateProviderProfileInput,
  };
}

function requirePlugin(payload: unknown): PluginRegistryEntry {
  if (!isRecord(payload)) throw new Error("Plugin request is invalid.");
  return payload as unknown as PluginRegistryEntry;
}

function requirePluginIdentity(payload: unknown): {
  readonly pluginId: string;
  readonly version: string;
} {
  if (
    !isRecord(payload) ||
    !exactFields(payload, ["pluginId", "version"]) ||
    typeof payload.pluginId !== "string" ||
    typeof payload.version !== "string"
  ) {
    throw new Error("Plugin identity is invalid.");
  }
  return { pluginId: payload.pluginId, version: payload.version };
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message === "DATA_UPSTREAM_TIMEOUT")
    return "DATA_UPSTREAM_TIMEOUT";
  if (error instanceof Error && /invalid/i.test(error.message))
    return "INVALID_REQUEST";
  if (error instanceof Error && /owner conflict/i.test(error.message))
    return "WORKSPACE_OWNER_CONFLICT";
  return "DATA_OPERATION_FAILED";
}

export function createUtilityRuntime(
  port: UtilityPort,
  scheduler: {
    readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
    readonly clearTimeout: (timer: unknown) => void;
  } = {
    setTimeout,
    clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
  },
): UtilityRuntime {
  let stopped = false;
  let stopping: Promise<void> | undefined;
  let state: UtilityState | undefined;
  let requestSequence = 0;
  const pendingUpstream = new Map<string, PendingUpstream>();
  const upstreamLive = new Map<string, UpstreamLiveSink>();
  const providerSubscriptions = new Map<
    string,
    { subscription?: ProviderSubscription }
  >();
  let removeListener = (): void => undefined;

  const postResult = (
    command: DataUtilityCommand,
    ok: boolean,
    payload?: unknown,
    code?: string,
  ): void => {
    port.postMessage({
      type: "data-result",
      contractVersion: ipcContractVersion,
      requestId: command.requestId,
      generation: command.generation,
      ok,
      ...(ok
        ? { payload: payload ?? null }
        : { code: code ?? "DATA_OPERATION_FAILED" }),
    });
  };

  const requireCurrentState = (generation: number): UtilityState => {
    const current = state;
    if (current === undefined || current.generation !== generation || stopped)
      throw new Error("Data utility generation is unavailable.");
    return current;
  };

  const upstreamRequest = (
    generation: number,
    providerProfileId: string,
    operation: DataUtilityUpstreamRequest["operation"],
    payload: unknown,
  ): Promise<unknown> => {
    requireCurrentState(generation);
    if (pendingUpstream.size >= maximumPendingRequests)
      return Promise.reject(
        new Error("Data utility request capacity exceeded."),
      );
    requestSequence += 1;
    const requestId = `upstream:${generation}:${requestSequence}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = scheduler.setTimeout(() => {
        if (!pendingUpstream.delete(requestId)) return;
        reject(new Error("DATA_UPSTREAM_TIMEOUT"));
      }, dataUtilityUpstreamTimeoutMs);
      pendingUpstream.set(requestId, { resolve, reject, timer });
      try {
        port.postMessage({
          type: "data-upstream-request",
          contractVersion: ipcContractVersion,
          requestId,
          generation,
          operation,
          providerProfileId,
          payload,
        });
      } catch {
        pendingUpstream.delete(requestId);
        scheduler.clearTimeout(timer);
        reject(new Error("Data utility upstream unavailable."));
      }
    });
  };

  const makeUpstream = (generation: number): ProviderDataUpstream => ({
    getCapabilities: async (providerProfileId): Promise<ProviderCapabilities> =>
      (await upstreamRequest(
        generation,
        providerProfileId,
        "get-capabilities",
        null,
      )) as ProviderCapabilities,
    getInstruments: async (
      providerProfileId,
    ): Promise<readonly ProviderInstrument[]> =>
      (await upstreamRequest(
        generation,
        providerProfileId,
        "get-instruments",
        null,
      )) as readonly ProviderInstrument[],
    requestHistory: async (providerProfileId, request) =>
      (await upstreamRequest(
        generation,
        providerProfileId,
        "request-history",
        request,
      )) as readonly import("@erc-chart/contracts").Candle[],
    subscribe: async (providerProfileId, request, sink) => {
      requestSequence += 1;
      const subscriptionId = `upstream-sub:${generation}:${requestSequence}`;
      upstreamLive.set(subscriptionId, { sink, generation });
      try {
        await upstreamRequest(generation, providerProfileId, "subscribe", {
          subscriptionId,
          request,
        });
      } catch (error) {
        upstreamLive.delete(subscriptionId);
        // Cleanup uses the existing release operation without consuming request capacity.
        if (!stopped)
          port.postMessage({
            type: "data-upstream-request",
            contractVersion: ipcContractVersion,
            requestId: `release:${subscriptionId}`,
            generation,
            providerProfileId,
            operation: "unsubscribe",
            payload: { subscriptionId },
          });
        throw error;
      }
      let disposed = false;
      return {
        unsubscribe: async (): Promise<void> => {
          if (disposed) return;
          disposed = true;
          upstreamLive.delete(subscriptionId);
          await upstreamRequest(generation, providerProfileId, "unsubscribe", {
            subscriptionId,
          });
        },
      };
    },
  });

  const initialize = async (
    message: import("@erc-chart/contracts").DataUtilityInitMessage,
  ): Promise<void> => {
    if (state !== undefined || stopped)
      throw new Error("Data utility is already initialized.");
    const database = await openStorageDatabase(message.databasePath);
    try {
      const startup = loadLatestWorkspaceSession(
        database,
        message.legacyWorkspaceId,
      );
      claimWorkspace(database, message.legacyWorkspaceId, message.instanceId);
      if (startup !== undefined && startup.id !== message.legacyWorkspaceId) {
        saveWorkspace(
          database,
          { ...startup, id: message.legacyWorkspaceId },
          message.instanceId,
        );
      }
      const service = createProviderDataService(
        makeUpstream(message.generation),
      );
      state = {
        generation: message.generation,
        database,
        instanceId: message.instanceId,
        legacyWorkspaceId: message.legacyWorkspaceId,
        service,
      };
      port.postMessage({ type: "ready", contractVersion: ipcContractVersion });
    } catch (error) {
      database.close();
      throw error;
    }
  };

  const handleCommand = async (command: DataUtilityCommand): Promise<void> => {
    const current = requireCurrentState(command.generation);
    switch (command.operation) {
      case "provider-capabilities": {
        const profileId = requireProfilePayload(command.payload);
        postResult(
          command,
          true,
          await current.service.getCapabilities(profileId),
        );
        return;
      }
      case "provider-instruments": {
        const profileId = requireProfilePayload(command.payload);
        postResult(
          command,
          true,
          await current.service.getInstruments(profileId),
        );
        return;
      }
      case "provider-history": {
        const { profileId, request } = requireHistoryPayload(command.payload);
        postResult(
          command,
          true,
          await current.service.requestHistory(profileId, request),
        );
        return;
      }
      case "provider-subscribe": {
        const { profileId, subscriptionId, request } = requireLivePayload(
          command.payload,
        );
        if (providerSubscriptions.has(subscriptionId))
          throw new Error("Provider live subscription ID is invalid.");
        const pending: { subscription?: ProviderSubscription } = {};
        providerSubscriptions.set(subscriptionId, pending);
        const sink: ProviderDataServiceSink = {
          onCandles: (candles, series): void => {
            if (
              state?.generation !== command.generation ||
              stopped ||
              providerSubscriptions.get(subscriptionId) !== pending
            )
              return;
            port.postMessage({
              type: "data-event",
              contractVersion: ipcContractVersion,
              generation: command.generation,
              subscriptionId,
              event: "candles",
              payload: { candles, series },
            });
          },
          onTicks: (ticks): void => {
            if (
              state?.generation !== command.generation ||
              stopped ||
              providerSubscriptions.get(subscriptionId) !== pending
            )
              return;
            port.postMessage({
              type: "data-event",
              contractVersion: ipcContractVersion,
              generation: command.generation,
              subscriptionId,
              event: "ticks",
              payload: ticks,
            });
          },
          onError: (code): void => {
            if (
              state?.generation !== command.generation ||
              stopped ||
              providerSubscriptions.get(subscriptionId) !== pending
            )
              return;
            port.postMessage({
              type: "data-event",
              contractVersion: ipcContractVersion,
              generation: command.generation,
              subscriptionId,
              event: "error",
              payload: code,
            });
          },
        };
        try {
          const subscription = await current.service.subscribe(
            profileId,
            request,
            sink,
          );
          if (
            stopped ||
            providerSubscriptions.get(subscriptionId) !== pending
          ) {
            await subscription.unsubscribe();
            throw new Error("Provider subscription was cancelled.");
          }
          pending.subscription = subscription;
          postResult(command, true, true);
        } catch (error) {
          if (providerSubscriptions.get(subscriptionId) === pending)
            providerSubscriptions.delete(subscriptionId);
          throw error;
        }
        return;
      }
      case "provider-unsubscribe": {
        const subscriptionId = requireSubscriptionId(command.payload);
        const subscription = providerSubscriptions.get(subscriptionId);
        if (subscription === undefined)
          throw new Error("Provider live subscription ID is invalid.");
        providerSubscriptions.delete(subscriptionId);
        await subscription.subscription?.unsubscribe();
        postResult(command, true, true);
        return;
      }
      case "provider-invalidate":
        await current.service.invalidateProfile(
          requireProfilePayload(command.payload),
        );
        postResult(command, true, true);
        return;
      case "provider-restore":
        await current.service.restoreProfile(
          requireProfilePayload(command.payload),
        );
        postResult(command, true, true);
        return;
      case "provider-shutdown":
        await current.service.shutdown();
        postResult(command, true, true);
        return;
      case "workspace-load":
        postResult(
          command,
          true,
          loadWorkspace(current.database, current.legacyWorkspaceId) ?? null,
        );
        return;
      case "workspace-save": {
        const workspace = requireWorkspace(command.payload);
        if (workspace.id !== current.legacyWorkspaceId)
          throw new Error("Workspace ID is invalid.");
        saveWorkspace(current.database, workspace, current.instanceId);
        postResult(command, true, true);
        return;
      }
      case "profile-list":
        postResult(command, true, listProviderProfiles(current.database));
        return;
      case "profile-get":
        postResult(
          command,
          true,
          getProviderProfile(
            current.database,
            requireProfilePayload(command.payload),
          ) ?? null,
        );
        return;
      case "profile-create":
        postResult(
          command,
          true,
          createProviderProfile(
            current.database,
            requireProviderProfileCreate(command.payload),
          ),
        );
        return;
      case "profile-update": {
        const { profileId, update } = requireProviderProfileUpdate(
          command.payload,
        );
        postResult(
          command,
          true,
          updateProviderProfile(current.database, profileId, update),
        );
        return;
      }
      case "profile-delete":
        postResult(
          command,
          true,
          deleteProviderProfile(
            current.database,
            requireProfilePayload(command.payload),
          ),
        );
        return;
      case "plugin-list":
        postResult(command, true, listPlugins(current.database));
        return;
      case "plugin-put":
        postResult(
          command,
          true,
          putPlugin(current.database, requirePlugin(command.payload)),
        );
        return;
      case "plugin-activate": {
        const identity = requirePluginIdentity(command.payload);
        postResult(
          command,
          true,
          activatePlugin(current.database, identity.pluginId, identity.version),
        );
        return;
      }
      case "plugin-disable": {
        const identity = requirePluginIdentity(command.payload);
        postResult(
          command,
          true,
          disablePlugin(current.database, identity.pluginId, identity.version),
        );
        return;
      }
      case "plugin-delete": {
        const identity = requirePluginIdentity(command.payload);
        postResult(
          command,
          true,
          deletePlugin(current.database, identity.pluginId, identity.version),
        );
        return;
      }
      case "process-info":
        postResult(command, true, { pid: nodeProcess.pid });
        return;
    }
  };

  const shutdown = (): Promise<void> => {
    if (stopping !== undefined) return stopping;
    stopping = (async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      removeListener();
      for (const pending of pendingUpstream.values()) {
        scheduler.clearTimeout(pending.timer);
        pending.reject(new Error("Data utility stopped."));
      }
      pendingUpstream.clear();
      upstreamLive.clear();
      const active = [...providerSubscriptions.values()];
      providerSubscriptions.clear();
      await Promise.allSettled(
        active.map(({ subscription }) => subscription?.unsubscribe()),
      );
      if (state !== undefined) {
        await state.service.shutdown().catch(() => undefined);
        state.database.close();
        state = undefined;
      }
      port.postMessage({
        type: "stopped",
        contractVersion: ipcContractVersion,
      });
    })();
    return stopping;
  };

  removeListener = port.onMessage((message) => {
    if (isUtilityControlMessage(message)) {
      void shutdown();
      return;
    }
    if (isDataUtilityInitMessage(message)) {
      void initialize(message).catch(() => {
        port.postMessage({
          type: "error",
          contractVersion: ipcContractVersion,
          code: "DATA_UTILITY_INIT_FAILED",
        });
      });
      return;
    }
    if (isDataUtilityUpstreamResult(message)) {
      if (message.generation !== state?.generation) return;
      const pending = pendingUpstream.get(message.requestId);
      if (pending === undefined) return;
      pendingUpstream.delete(message.requestId);
      scheduler.clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.payload);
      else pending.reject(new Error(message.code ?? "UPSTREAM_FAILED"));
      return;
    }
    if (isDataUtilityUpstreamEvent(message)) {
      if (message.generation !== state?.generation) return;
      const live = upstreamLive.get(message.subscriptionId);
      if (live === undefined || live.generation !== message.generation) return;
      if (message.event === "candles" && Array.isArray(message.payload))
        live.sink.onCandles(message.payload as never);
      else if (message.event === "ticks" && Array.isArray(message.payload))
        live.sink.onTicks(message.payload as never);
      else if (message.event === "error" && typeof message.payload === "string")
        live.sink.onError(message.payload);
      return;
    }
    if (isDataUtilityCommand(message)) {
      void handleCommand(message).catch((error) => {
        postResult(message, false, undefined, errorCode(error));
      });
    }
  });

  return { shutdown };
}
