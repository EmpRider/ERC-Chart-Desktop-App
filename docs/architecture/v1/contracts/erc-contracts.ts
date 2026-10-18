/**
 * ERC-chart contract sketch, API version 1.
 *
 * This is an architecture artifact, not a drop-in SDK implementation.
 * Runtime boundaries must validate equivalent schemas before accepting data.
 */

export const ERC_HOST_API_VERSION = '1.0.0' as const;

export type EpochMs = number;
export type PluginKind = 'provider' | 'indicator';
export type ChartType = 'candlestick' | 'line' | 'area';
export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'live'
    | 'reconnecting'
    | 'stale'
    | 'auth-required'
    | 'incompatible'
    | 'error';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ContractRef {
    name: string;
    version: string;
}

export interface MessageEnvelope<TType extends string, TPayload> {
    contract: ContractRef;
    type: TType;
    requestId?: string;
    generation?: number;
    sentAtMs: EpochMs;
    payload: TPayload;
}

export interface FeedKey {
    providerId: string;
    profileId: string;
    feedId: string;
}

export interface Instrument {
    id: string;
    symbol: string;
    displayName: string;
    pricePrecision: number;
    status: 'active' | 'inactive' | 'unknown';
    metadata?: JsonObject;
}

export interface BarAlignment {
    mode: 'epoch' | 'session';
    originMs: EpochMs;
    timeZone: 'UTC' | string;
}

export interface TimeframeCapability {
    seconds: number;
    historical: boolean;
    live: boolean;
    native: boolean;
    derivedFromSeconds?: number;
    alignment: BarAlignment;
}

export interface ProviderCapabilities {
    historicalCandles: boolean;
    liveTicks: boolean;
    liveCandles: boolean;
    volume: boolean;
    bidAsk: boolean;
    instruments: Instrument[];
    timeframes: TimeframeCapability[];
}

export interface Candle {
    feed: FeedKey;
    instrumentId: string;
    timeframeSeconds: number;
    openTimeMs: EpochMs;
    closeTimeMs?: EpochMs;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    isFinal: boolean;
    revision: number;
}

export interface Tick {
    feed: FeedKey;
    instrumentId: string;
    timeMs: EpochMs;
    receivedAtMs: EpochMs;
    price: number;
    bid?: number;
    ask?: number;
    volume?: number;
    sequence?: string | number;
}

/**
 * Typed arrays are host-owned immutable snapshots by contract.
 * A worker receives its own buffers and must not retain old generations.
 */
export interface CandleSnapshot {
    feed: FeedKey;
    instrumentId: string;
    timeframeSeconds: number;
    generation: number;
    revision: number;
    baseIndex: number;
    timeMs: Float64Array;
    open: Float64Array;
    high: Float64Array;
    low: Float64Array;
    close: Float64Array;
    volume?: Float64Array;
    hl2: Float64Array;
    hlc3: Float64Array;
    ohlc4: Float64Array;
    building?: Candle;
}

export interface HistoryRequest {
    instrumentId: string;
    timeframeSeconds: number;
    fromMs?: EpochMs;
    toMs?: EpochMs;
    limit: number;
}

export interface HistoryPage {
    candles: Candle[];
    nextCursor?: string;
    complete: boolean;
}

export interface CredentialDescriptor {
    key: string;
    label: string;
    secret: boolean;
    required: boolean;
}

export interface ProviderDescriptor {
    providerId: string;
    displayName: string;
    credentials: CredentialDescriptor[];
}

export interface ProviderLogger {
    debug(code: string, metadata?: JsonObject): void;
    info(code: string, metadata?: JsonObject): void;
    warn(code: string, metadata?: JsonObject): void;
    error(code: string, metadata?: JsonObject): void;
}

export interface CredentialLease {
    get(key: string): Promise<string>;
}

export interface HttpRequest {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    timeoutMs?: number;
}

export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    body: Uint8Array;
}

export interface WebSocketOpenRequest {
    url: string;
    headers?: Record<string, string>;
    protocols?: string[];
}

export interface WebSocketConnection {
    send(data: string | Uint8Array): Promise<void>;
    close(code?: number, reason?: string): Promise<void>;
    onMessage(listener: (data: string | Uint8Array) => void): () => void;
    onClose(listener: (code: number, reason: string) => void): () => void;
    onError(listener: (code: string) => void): () => void;
}

/**
 * The host enforces manifest network allowlists before performing requests.
 */
export interface ProviderNetworkBroker {
    request(request: HttpRequest): Promise<HttpResponse>;
    openWebSocket(request: WebSocketOpenRequest): Promise<WebSocketConnection>;
}

export interface ProviderHostServices {
    profileId: string;
    credentials: CredentialLease;
    network: ProviderNetworkBroker;
    logger: ProviderLogger;
    now(): EpochMs;
    emitStatus(state: ConnectionState, code?: string): void;
    emitTick(tick: Tick): void;
    emitCandle(candle: Candle): void;
}

export interface ProviderSubscription {
    instrumentId: string;
    timeframeSeconds?: number;
}

export interface ProviderSubscriptionHandle {
    unsubscribe(): Promise<void>;
}

export interface ProviderAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getCapabilities(): Promise<ProviderCapabilities>;
    getInstruments(): Promise<Instrument[]>;
    requestHistory(request: HistoryRequest): Promise<HistoryPage>;
    subscribe(subscription: ProviderSubscription): Promise<ProviderSubscriptionHandle>;
}

export interface ProviderDefinition {
    readonly descriptor: ProviderDescriptor;
    readonly configSchema: JsonObject;
    create(
        host: ProviderHostServices,
        normalizedConfig: JsonObject,
    ): ProviderAdapter | Promise<ProviderAdapter>;
}

export type IndicatorValueType = 'number-series' | 'boolean-series' | 'scalar';

export interface IndicatorInputDefinition {
    key: string;
    label: string;
    type: IndicatorValueType | 'candles' | 'ticks';
    required: boolean;
    affects: 'calculation' | 'presentation';
}

export interface IndicatorOutputDefinition {
    key: string;
    label: string;
    type: IndicatorValueType;
}

export interface IndicatorDefinition {
    id: string;
    name: string;
    overlay: boolean;
    requiresLiveTicks: boolean;
    inputs: IndicatorInputDefinition[];
    outputs: IndicatorOutputDefinition[];
    configSchema: JsonObject;
}

export type IndicatorInputBinding =
    | {
        kind: 'candles';
        timeframeSeconds?: number;
    }
    | {
        kind: 'ticks';
    }
    | {
        kind: 'indicator-output';
        instanceId: string;
        outputKey: string;
    };

export interface IndicatorInstanceConfig {
    instanceId: string;
    pluginId: string;
    definitionId: string;
    enabled: boolean;
    parameters: JsonObject;
    style: JsonObject;
    inputs: Record<string, IndicatorInputBinding>;
}

export interface IndicatorOutputBatch {
    generation: number;
    sourceRevision: number;
    outputs: Record<string, Float64Array | Uint8Array | number>;
    plots: PlotInstruction[];
    signalCandidates?: SignalCandidate[];
}

export interface BarEvent {
    kind: 'building-updated' | 'bar-finalized' | 'history-replaced';
    generation: number;
    revision: number;
    candle: Candle;
}

/**
 * Normalized host result. Raw klinecharts indicator.result values never cross
 * the renderer adapter boundary.
 */
export interface IndicatorResultPoint {
    indicatorInstanceId: string;
    outputKey: string;
    barOpenTimeMs: EpochMs;
    value: number | boolean | null;
    state: 'provisional' | 'finalized';
    sourceRevision: number;
    configGeneration: number;
}

export interface IndicatorResultReadOptions {
    outputKey?: string;
    finalizedOnly?: boolean;
}

/**
 * Host-only bounded reader used by signal processing. It is not exported to
 * indicator plugins and does not expose candle storage or klinecharts objects.
 */
export interface IndicatorResultReader {
    latest(
        indicatorInstanceId: string,
        options?: IndicatorResultReadOptions,
    ): IndicatorResultPoint | null;
    last(
        indicatorInstanceId: string,
        count: number,
        options?: IndicatorResultReadOptions,
    ): readonly IndicatorResultPoint[];
}

/**
 * Indicator plugin entry modules register definitions through the clean
 * indicator()/input/plot/ta facade. Runtime context and lifecycle ports are
 * deliberately host-private and are not part of this public sketch.
 */
export interface IndicatorPluginModule {
    readonly definitions: readonly IndicatorDefinition[];
}

export interface PlotBase {
    id: string;
    title: string;
    visible: boolean;
    color?: string;
    opacity?: number;
    lineWidth?: number;
}

export interface LinePlot extends PlotBase {
    kind: 'line';
    values: Float64Array;
    lineStyle?: 'solid' | 'dashed' | 'dotted';
}

export interface HorizontalLinePlot extends PlotBase {
    kind: 'horizontal-line';
    value: number;
}

export interface HistogramPlot extends PlotBase {
    kind: 'histogram';
    values: Float64Array;
    baseline?: number;
    negativeColor?: string;
}

export interface BandPlot extends PlotBase {
    kind: 'band';
    upper: Float64Array;
    lower: Float64Array;
    fillColor?: string;
}

export interface ShapePoint {
    barIndex: number;
    value?: number;
    text?: string;
}

export interface ShapePlot extends PlotBase {
    kind: 'shape';
    shape: 'circle' | 'triangle-up' | 'triangle-down' | 'diamond' | 'square';
    location: 'above-bar' | 'below-bar' | 'absolute';
    points: ShapePoint[];
}

export interface Segment {
    fromBarIndex: number;
    fromValue: number;
    toBarIndex: number;
    toValue: number;
}

export interface SegmentPlot extends PlotBase {
    kind: 'segment';
    segments: Segment[];
}

export interface PlotBox {
    fromBarIndex: number;
    toBarIndex: number;
    top: number;
    bottom: number;
    fillColor?: string;
}

export interface BoxPlot extends PlotBase {
    kind: 'box';
    boxes: PlotBox[];
}

export interface PlotText {
    barIndex: number;
    value: number;
    text: string;
}

export interface TextPlot extends PlotBase {
    kind: 'text';
    labels: PlotText[];
}

export type PlotInstruction =
    | LinePlot
    | HorizontalLinePlot
    | HistogramPlot
    | BandPlot
    | ShapePlot
    | SegmentPlot
    | BoxPlot
    | TextPlot;

/**
 * Defined for post-MVP compatibility. The MVP host does not route or deliver it.
 */
export interface SignalCandidate {
    contractVersion: 1;
    eventId: string;
    pluginId: string;
    indicatorInstanceId: string;
    feed: FeedKey;
    instrumentId: string;
    timeframeSeconds: number;
    direction: 'buy' | 'sell' | 'neutral' | string;
    occurredAtMs: EpochMs;
    barOpenTimeMs: EpochMs;
    state: 'provisional' | 'finalized' | 'cancelled';
    confidence?: number;
    sourceRevision: number;
    metadata?: JsonObject;
}

export interface ChartSlotDocument {
    id: string;
    providerProfileId: string;
    instrumentId: string;
    timeframeSeconds: number;
    chartType: ChartType;
    indicators: IndicatorInstanceConfig[];
    viewport?: {
        visibleBars: number;
        rightOffsetBars: number;
        priceScaleMode: 'auto' | 'manual';
        manualPriceMin?: number;
        manualPriceMax?: number;
    };
}

export interface WorkspaceTabDocument {
    id: string;
    title: string;
    layout:
        | 'grid-1'
        | 'split-horizontal'
        | 'split-vertical'
        | 'grid-3-left'
        | 'grid-3-top'
        | 'grid-4';
    chartSlots: ChartSlotDocument[];
}

/**
 * Drawing objects are deliberately absent from workspace version 1.
 */
export interface WorkspaceDocument {
    schemaVersion: 1;
    id: string;
    name: string;
    activeTabId: string;
    tabs: WorkspaceTabDocument[];
    savedAtMs: EpochMs;
}
