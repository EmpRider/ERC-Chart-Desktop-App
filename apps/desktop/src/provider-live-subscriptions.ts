import type {
  ProviderLiveEvent,
  ProviderLiveSubscriptionRequest,
} from "@erc-chart/contracts";
import type { DesktopApplicationController } from "@erc-chart/electron-main";

type ProviderSubscriptionRequest = Parameters<
  DesktopApplicationController["subscribeProviderData"]
>[1];
type ProviderSubscription = Awaited<
  ReturnType<DesktopApplicationController["subscribeProviderData"]>
>;

export interface ProviderLiveRendererSink {
  readonly ownerId: number;
  readonly isClosed: () => boolean;
  readonly send: (event: ProviderLiveEvent) => void;
  readonly onClosed: (listener: () => void) => () => void;
}

export interface ProviderLiveSubscriptionManager {
  readonly start: (
    request: ProviderLiveSubscriptionRequest,
    sink: ProviderLiveRendererSink,
  ) => Promise<void>;
  readonly stop: (subscriptionId: string, ownerId: number) => Promise<boolean>;
  readonly shutdown: () => Promise<void>;
}

interface ActiveSubscription {
  readonly ownerId: number;
  readonly subscription: ProviderSubscription;
  readonly removeClosedListener: () => void;
}

interface PendingSubscription {
  readonly task: Promise<void>;
}

export function createProviderLiveSubscriptionManager(
  controller: Pick<DesktopApplicationController, "subscribeProviderData">,
): ProviderLiveSubscriptionManager {
  const active = new Map<string, ActiveSubscription>();
  const pending = new Map<string, PendingSubscription>();
  let stopped = false;

  const stop = async (
    subscriptionId: string,
    ownerId: number,
  ): Promise<boolean> => {
    const current = active.get(subscriptionId);
    if (current === undefined || current.ownerId !== ownerId) return false;
    active.delete(subscriptionId);
    current.removeClosedListener();
    await current.subscription.unsubscribe();
    return true;
  };

  const start = (
    request: ProviderLiveSubscriptionRequest,
    sink: ProviderLiveRendererSink,
  ): Promise<void> => {
    if (stopped) {
      return Promise.reject(
        new Error("Provider live subscriptions are stopped."),
      );
    }
    if (
      active.has(request.subscriptionId) ||
      pending.has(request.subscriptionId)
    ) {
      return Promise.reject(
        new Error("Provider live subscription already exists."),
      );
    }

    let closed = sink.isClosed();
    const removeClosedListener = sink.onClosed(() => {
      closed = true;
      void stop(request.subscriptionId, sink.ownerId).catch(() => undefined);
    });
    const task = (async (): Promise<void> => {
      try {
        const subscription = await controller.subscribeProviderData(
          request.profileId,
          {
            instrumentId:
              request.instrumentId as ProviderSubscriptionRequest["instrumentId"],
            timeframeId:
              request.timeframeId as ProviderSubscriptionRequest["timeframeId"],
          },
          {
            onCandles: (candles): void => {
              if (closed || sink.isClosed()) return;
              sink.send({
                subscriptionId: request.subscriptionId,
                type: "candles",
                candles,
              });
            },
            onTicks: (): void => undefined,
            onError: (code): void => {
              if (closed || sink.isClosed()) return;
              sink.send({
                subscriptionId: request.subscriptionId,
                type: "error",
                code,
              });
            },
          },
        );
        if (stopped || closed || sink.isClosed()) {
          removeClosedListener();
          await subscription.unsubscribe();
          return;
        }
        active.set(request.subscriptionId, {
          ownerId: sink.ownerId,
          subscription,
          removeClosedListener,
        });
      } catch (error) {
        removeClosedListener();
        throw error;
      }
    })();
    pending.set(request.subscriptionId, { task });
    return task.finally(() => {
      if (pending.get(request.subscriptionId)?.task === task) {
        pending.delete(request.subscriptionId);
      }
    });
  };

  return {
    start,
    stop,
    shutdown: async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      const activeSubscriptions = [...active.values()];
      active.clear();
      for (const current of activeSubscriptions) current.removeClosedListener();
      await Promise.all([
        ...activeSubscriptions.map((current) =>
          current.subscription.unsubscribe(),
        ),
        ...[...pending.values()].map(({ task }) => task.catch(() => undefined)),
      ]);
    },
  };
}
