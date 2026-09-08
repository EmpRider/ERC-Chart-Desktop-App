import type { Candle } from "@erc-chart/contracts";
import { authoringFrame, useKernel } from "./authoring-context.js";

export const movingAverageTypes = [
  "sma",
  "ema",
  "wma",
  "rma",
  "smma",
  "arma",
  "a2rma",
  "dema",
  "tema",
  "zlema",
  "hma",
  "kama",
  "t3",
  "vidya",
  "mcginley",
  "jma",
  "lsma",
  "tma",
  "swma",
  "alma",
] as const;

export type MovingAverageType = (typeof movingAverageTypes)[number];
export type TaUpdatePhase = "building" | "finalized";

export interface NumericTaKernel {
  readonly update: (value: number, phase: TaUpdatePhase) => number;
}

export interface CandleTaKernel<T> {
  readonly update: (candle: Candle, phase: TaUpdatePhase) => T;
}

export interface DmiPoint {
  readonly adx: number;
  readonly plusDI: number;
  readonly minusDI: number;
}

export interface DmiSeries {
  readonly adx: number[];
  readonly plusDI: number[];
  readonly minusDI: number[];
}

class RollingWindow {
  readonly #capacity: number;
  readonly #values: number[];
  #start = 0;
  #count = 0;
  #sum = 0;
  #invalid = 0;

  constructor(capacity: number) {
    this.#capacity = Math.max(1, Math.floor(capacity));
    this.#values = Array<number>(this.#capacity).fill(Number.NaN);
  }

  get count(): number {
    return this.#count;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get sum(): number {
    return this.#sum;
  }

  get invalid(): number {
    return this.#invalid;
  }

  at(offset: number): number {
    if (offset < 0 || offset >= this.#count) return Number.NaN;
    return this.#values[(this.#start + offset) % this.#capacity] ?? Number.NaN;
  }

  oldest(): number {
    return this.at(0);
  }

  newest(): number {
    return this.at(this.#count - 1);
  }

  candidate(value: number): { readonly sum: number; readonly invalid: number } {
    let sum = this.#sum;
    let invalid = this.#invalid;
    if (this.#count === this.#capacity) {
      const expired = this.oldest();
      if (Number.isFinite(expired)) sum -= expired;
      else invalid -= 1;
    }
    if (Number.isFinite(value)) sum += value;
    else invalid += 1;
    return { sum, invalid };
  }

  commit(value: number): void {
    if (this.#count < this.#capacity) {
      const index = (this.#start + this.#count) % this.#capacity;
      this.#values[index] = value;
      this.#count += 1;
    } else {
      const expired = this.#values[this.#start] ?? Number.NaN;
      if (Number.isFinite(expired)) this.#sum -= expired;
      else this.#invalid -= 1;
      this.#values[this.#start] = value;
      this.#start = (this.#start + 1) % this.#capacity;
    }
    if (Number.isFinite(value)) this.#sum += value;
    else this.#invalid += 1;
  }

  valuesWithCandidate(value: number): number[] {
    const result: number[] = [];
    const start = this.#count === this.#capacity ? 1 : 0;
    for (let index = start; index < this.#count; index += 1) {
      result.push(this.at(index));
    }
    result.push(value);
    return result;
  }
}

class SmaKernel implements NumericTaKernel {
  readonly #window: RollingWindow;

  constructor(period: number) {
    this.#window = new RollingWindow(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const candidate = this.#window.candidate(value);
    const ready =
      Math.min(this.#window.count + 1, this.#window.capacity) ===
      this.#window.capacity;
    const result =
      ready && candidate.invalid === 0
        ? candidate.sum / this.#window.capacity
        : Number.NaN;
    if (phase === "finalized") this.#window.commit(value);
    return result;
  }
}

class EmaKernel implements NumericTaKernel {
  readonly #seed: SmaKernel;
  readonly #alpha: number;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#seed = new SmaKernel(period);
    this.#alpha = 2 / (period + 1);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const seed = this.#seed.update(value, phase);
    const result = Number.isFinite(this.#committed)
      ? Number.isFinite(value)
        ? this.#alpha * value + (1 - this.#alpha) * this.#committed
        : Number.NaN
      : seed;
    if (phase === "finalized" && Number.isFinite(result))
      this.#committed = result;
    return result;
  }
}

class RmaKernel implements NumericTaKernel {
  readonly #seed: SmaKernel;
  readonly #period: number;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#period = period;
    this.#seed = new SmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const seed = this.#seed.update(value, phase);
    const result = Number.isFinite(this.#committed)
      ? Number.isFinite(value)
        ? (this.#committed * (this.#period - 1) + value) / this.#period
        : Number.NaN
      : seed;
    if (phase === "finalized" && Number.isFinite(result))
      this.#committed = result;
    return result;
  }
}

class WindowWeightedKernel implements NumericTaKernel {
  readonly #window: RollingWindow;
  readonly #mode: "wma" | "lsma" | "alma" | "swma";

  constructor(period: number, mode: "wma" | "lsma" | "alma" | "swma") {
    this.#window = new RollingWindow(
      mode === "swma" ? Math.min(4, period) : period,
    );
    this.#mode = mode;
  }

  update(value: number, phase: TaUpdatePhase): number {
    const values = this.#window.valuesWithCandidate(value);
    const ready =
      values.length === this.#window.capacity && values.every(Number.isFinite);
    let result = Number.NaN;
    if (ready) {
      if (this.#mode === "wma") {
        const denominator = (values.length * (values.length + 1)) / 2;
        result =
          values.reduce((sum, item, index) => sum + item * (index + 1), 0) /
          denominator;
      } else if (this.#mode === "lsma") {
        const period = values.length;
        const xSum = (period * (period - 1)) / 2;
        const x2Sum = ((period - 1) * period * (2 * period - 1)) / 6;
        const ySum = values.reduce((sum, item) => sum + item, 0);
        const xySum = values.reduce(
          (sum, item, index) => sum + index * item,
          0,
        );
        const denominator = period * x2Sum - xSum * xSum;
        if (denominator !== 0) {
          const slope = (period * xySum - xSum * ySum) / denominator;
          result = (ySum - slope * xSum) / period + slope * (period - 1);
        }
      } else if (this.#mode === "alma") {
        const period = values.length;
        const m = 0.85 * (period - 1);
        const sigma = period / 6;
        let sum = 0;
        let norm = 0;
        for (let index = 0; index < period; index += 1) {
          const weight = Math.exp(-((index - m) ** 2) / (2 * sigma ** 2));
          norm += weight;
          sum += (values[index] ?? 0) * weight;
        }
        result = norm > 0 ? sum / norm : Number.NaN;
      } else if (values.length < 4) {
        result = values.reduce((sum, item) => sum + item, 0) / values.length;
      } else {
        result =
          ((values[0] ?? 0) +
            (values[3] ?? 0) +
            2 * (values[1] ?? 0) +
            2 * (values[2] ?? 0)) /
          6;
      }
    }
    if (phase === "finalized") this.#window.commit(value);
    return result;
  }
}

class DemaKernel implements NumericTaKernel {
  readonly #first: EmaKernel;
  readonly #second: EmaKernel;

  constructor(period: number) {
    this.#first = new EmaKernel(period);
    this.#second = new EmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const first = this.#first.update(value, phase);
    const second = this.#second.update(first, phase);
    return 2 * first - second;
  }
}

class TemaKernel implements NumericTaKernel {
  readonly #first: EmaKernel;
  readonly #second: EmaKernel;
  readonly #third: EmaKernel;

  constructor(period: number) {
    this.#first = new EmaKernel(period);
    this.#second = new EmaKernel(period);
    this.#third = new EmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const first = this.#first.update(value, phase);
    const second = this.#second.update(first, phase);
    const third = this.#third.update(second, phase);
    return 3 * first - 3 * second + third;
  }
}

class ZlemaKernel implements NumericTaKernel {
  readonly #lag: number;
  readonly #history: RollingWindow;
  readonly #ema: EmaKernel;

  constructor(period: number) {
    this.#lag = Math.floor((period - 1) / 2);
    this.#history = new RollingWindow(Math.max(1, this.#lag));
    this.#ema = new EmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const lagged =
      this.#lag === 0 || this.#history.count < this.#lag
        ? value
        : this.#history.oldest();
    const adjusted = this.#lag === 0 ? value : value + (value - lagged);
    const result = this.#ema.update(adjusted, phase);
    if (phase === "finalized" && this.#lag > 0) this.#history.commit(value);
    return result;
  }
}

class HmaKernel implements NumericTaKernel {
  readonly #half: WindowWeightedKernel;
  readonly #full: WindowWeightedKernel;
  readonly #hma: WindowWeightedKernel;

  constructor(period: number) {
    this.#half = new WindowWeightedKernel(
      Math.max(1, Math.floor(period / 2)),
      "wma",
    );
    this.#full = new WindowWeightedKernel(period, "wma");
    this.#hma = new WindowWeightedKernel(
      Math.max(1, Math.floor(Math.sqrt(period))),
      "wma",
    );
  }

  update(value: number, phase: TaUpdatePhase): number {
    const half = this.#half.update(value, phase);
    const full = this.#full.update(value, phase);
    const diff =
      Number.isFinite(half) && Number.isFinite(full)
        ? 2 * half - full
        : Number.NaN;
    return this.#hma.update(diff, phase);
  }
}

class TmaKernel implements NumericTaKernel {
  readonly #first: SmaKernel;
  readonly #second: SmaKernel;

  constructor(period: number) {
    this.#first = new SmaKernel(Math.ceil((period + 1) / 2));
    this.#second = new SmaKernel(Math.floor((period + 1) / 2));
  }

  update(value: number, phase: TaUpdatePhase): number {
    return this.#second.update(this.#first.update(value, phase), phase);
  }
}

class T3Kernel implements NumericTaKernel {
  readonly #emas: readonly EmaKernel[];

  constructor(period: number) {
    this.#emas = Array.from({ length: 6 }, () => new EmaKernel(period));
  }

  update(value: number, phase: TaUpdatePhase): number {
    const values: number[] = [];
    let current = value;
    for (const kernel of this.#emas) {
      current = kernel.update(current, phase);
      values.push(current);
    }
    const factor = 0.7;
    const c1 = -(factor ** 3);
    const c2 = 3 * factor ** 2 + 3 * factor ** 3;
    const c3 = -6 * factor ** 2 - 3 * factor - 3 * factor ** 3;
    const c4 = 1 + 3 * factor + factor ** 3 + 3 * factor ** 2;
    return (
      c1 * (values[5] ?? Number.NaN) +
      c2 * (values[4] ?? Number.NaN) +
      c3 * (values[3] ?? Number.NaN) +
      c4 * (values[2] ?? Number.NaN)
    );
  }
}

class KamaKernel implements NumericTaKernel {
  readonly #period: number;
  readonly #window: RollingWindow;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#period = period;
    this.#window = new RollingWindow(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    let result = Number.NaN;
    if (this.#window.count === this.#period && Number.isFinite(value)) {
      const old = this.#window.oldest();
      let volatility = 0;
      let previous = old;
      for (let index = 1; index < this.#window.count; index += 1) {
        const current = this.#window.at(index);
        volatility += Math.abs(current - previous);
        previous = current;
      }
      volatility += Math.abs(value - previous);
      const efficiency =
        volatility > 0 ? Math.abs(value - old) / volatility : 0;
      const smoothing = (efficiency * (2 / 3 - 2 / 31) + 2 / 31) ** 2;
      const seed = (this.#window.sum - old + value) / this.#period;
      const base = Number.isFinite(this.#committed) ? this.#committed : seed;
      result = base + smoothing * (value - base);
    }
    if (phase === "finalized") {
      this.#window.commit(value);
      if (Number.isFinite(result)) this.#committed = result;
    }
    return result;
  }
}

class VidyaKernel implements NumericTaKernel {
  readonly #period: number;
  readonly #window: RollingWindow;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#period = period;
    this.#window = new RollingWindow(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    let result = Number.NaN;
    if (this.#window.count === this.#period && Number.isFinite(value)) {
      let up = 0;
      let down = 0;
      let previous = this.#window.oldest();
      for (let index = 1; index < this.#window.count; index += 1) {
        const current = this.#window.at(index);
        const change = current - previous;
        if (change > 0) up += change;
        else down -= change;
        previous = current;
      }
      const candidateChange = value - previous;
      if (candidateChange > 0) up += candidateChange;
      else down -= candidateChange;
      const cmo = up + down > 0 ? Math.abs((up - down) / (up + down)) : 0;
      const alpha = (2 / (this.#period + 1)) * cmo;
      const seed =
        (this.#window.sum - this.#window.oldest() + value) / this.#period;
      const base = Number.isFinite(this.#committed) ? this.#committed : seed;
      result = alpha * value + (1 - alpha) * base;
    }
    if (phase === "finalized") {
      this.#window.commit(value);
      if (Number.isFinite(result)) this.#committed = result;
    }
    return result;
  }
}

class McGinleyKernel implements NumericTaKernel {
  readonly #period: number;
  readonly #seed: SmaKernel;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#period = period;
    this.#seed = new SmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const seed = this.#seed.update(value, phase);
    const previous = Number.isFinite(this.#committed) ? this.#committed : seed;
    let result = previous;
    if (
      Number.isFinite(previous) &&
      Number.isFinite(value) &&
      previous !== 0 &&
      value !== 0
    ) {
      const denominator = this.#period * (value / previous) ** 4;
      if (
        Number.isFinite(denominator) &&
        Math.abs(denominator) > Number.EPSILON
      ) {
        result = previous + (value - previous) / denominator;
      }
    }
    if (phase === "finalized" && Number.isFinite(result))
      this.#committed = result;
    return result;
  }
}

class JmaKernel implements NumericTaKernel {
  readonly #beta: number;
  readonly #alpha: number;
  #e0 = Number.NaN;
  #e1 = 0;
  #e2 = 0;
  #committed = Number.NaN;

  constructor(period: number) {
    const denominator = 0.45 * (period - 1) + 2;
    this.#beta = denominator === 0 ? 0 : (0.45 * (period - 1)) / denominator;
    this.#alpha = this.#beta ** 2;
  }

  update(value: number, phase: TaUpdatePhase): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const e0 =
      (1 - this.#alpha) * value +
      this.#alpha * (Number.isFinite(this.#e0) ? this.#e0 : value);
    const e1 = (value - e0) * (1 - this.#beta) + this.#beta * this.#e1;
    const base = Number.isFinite(this.#committed) ? this.#committed : value;
    const e2 =
      (e0 + 0.5 * e1 - base) * (1 - this.#alpha) ** 2 +
      this.#alpha ** 2 * this.#e2;
    const result = base + e2;
    if (phase === "finalized") {
      this.#e0 = e0;
      this.#e1 = e1;
      this.#e2 = e2;
      this.#committed = result;
    }
    return result;
  }
}

class ArmaKernel implements NumericTaKernel {
  readonly #ema: EmaKernel;
  #committed = Number.NaN;

  constructor(period: number) {
    this.#ema = new EmaKernel(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const basis = this.#ema.update(value, phase);
    const result = Number.isFinite(this.#committed)
      ? this.#committed + (basis - this.#committed) / 3
      : basis;
    if (phase === "finalized" && Number.isFinite(result))
      this.#committed = result;
    return result;
  }
}

class A2rmaKernel implements NumericTaKernel {
  readonly #period: number;
  readonly #raw: ArmaKernel;
  readonly #window: RollingWindow;
  #ama1 = Number.NaN;
  #ama2 = Number.NaN;

  constructor(period: number) {
    this.#period = period;
    this.#raw = new ArmaKernel(period);
    this.#window = new RollingWindow(period);
  }

  update(value: number, phase: TaUpdatePhase): number {
    const raw = this.#raw.update(value, phase);
    let result = raw;
    let ama1 = this.#ama1;
    let ama2 = this.#ama2;
    if (
      this.#window.count === this.#period &&
      Number.isFinite(value) &&
      Number.isFinite(raw)
    ) {
      const old = this.#window.oldest();
      let volatility = 0;
      let previous = old;
      for (let index = 1; index < this.#window.count; index += 1) {
        const current = this.#window.at(index);
        volatility += Math.abs(current - previous);
        previous = current;
      }
      volatility += Math.abs(value - previous);
      const efficiency =
        volatility > 0 ? Math.abs(value - old) / volatility : 0;
      const previousAma1 = Number.isFinite(this.#ama1) ? this.#ama1 : raw;
      ama1 = efficiency * raw + (1 - efficiency) * previousAma1;
      const previousAma2 = Number.isFinite(this.#ama2) ? this.#ama2 : ama1;
      ama2 = efficiency * ama1 + (1 - efficiency) * previousAma2;
      result = ama2;
    }
    if (phase === "finalized") {
      this.#window.commit(value);
      if (Number.isFinite(ama1)) this.#ama1 = ama1;
      if (Number.isFinite(ama2)) this.#ama2 = ama2;
    }
    return result;
  }
}

export function createMovingAverageKernel(
  type: MovingAverageType,
  periodValue: number,
): NumericTaKernel {
  const period = Math.max(1, Math.floor(periodValue));
  switch (type) {
    case "sma":
      return new SmaKernel(period);
    case "ema":
      return new EmaKernel(period);
    case "rma":
    case "smma":
      return new RmaKernel(period);
    case "wma":
      return new WindowWeightedKernel(period, "wma");
    case "dema":
      return new DemaKernel(period);
    case "tema":
      return new TemaKernel(period);
    case "zlema":
      return new ZlemaKernel(period);
    case "hma":
      return new HmaKernel(period);
    case "tma":
      return new TmaKernel(period);
    case "t3":
      return new T3Kernel(period);
    case "kama":
      return new KamaKernel(period);
    case "vidya":
      return new VidyaKernel(period);
    case "mcginley":
      return new McGinleyKernel(period);
    case "jma":
      return new JmaKernel(period);
    case "lsma":
      return new WindowWeightedKernel(period, "lsma");
    case "swma":
      return new WindowWeightedKernel(period, "swma");
    case "alma":
      return new WindowWeightedKernel(period, "alma");
    case "arma":
      return new ArmaKernel(period);
    case "a2rma":
      return new A2rmaKernel(period);
  }
}

export function movingAverage(
  values: readonly number[],
  type: MovingAverageType,
  period: number,
): number[];
export function movingAverage(
  value: number,
  type: MovingAverageType,
  period: number,
): number;
export function movingAverage(
  values: readonly number[] | number,
  type: MovingAverageType,
  period: number,
): number[] | number {
  if (typeof values === "number")
    return numericCall(`ma-${type}`, values, period, (length) =>
      createMovingAverageKernel(type, length),
    );
  const kernel = createMovingAverageKernel(type, period);
  return values.map((value) => kernel.update(value, "finalized"));
}

export function trueRange(candles: readonly Candle[]): number[] {
  return candles.map((candle, index) => {
    const previousClose =
      index === 0 ? candle.close : (candles[index - 1]?.close ?? candle.close);
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
}

export function createAtrKernel(periodValue: number): CandleTaKernel<number> {
  const rma = new RmaKernel(Math.max(1, Math.floor(periodValue)));
  let previousClose = Number.NaN;
  return {
    update(candle, phase) {
      const prior = Number.isFinite(previousClose)
        ? previousClose
        : candle.close;
      const range = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prior),
        Math.abs(candle.low - prior),
      );
      const result = rma.update(range, phase);
      if (phase === "finalized") previousClose = candle.close;
      return result;
    },
  };
}

export function atr(period: number): number;
export function atr(candles: readonly Candle[], period: number): number[];
export function atr(
  candles: readonly Candle[] | number,
  period?: number,
): number[] | number {
  if (typeof candles === "number") {
    const frame = authoringFrame();
    const length = authoringLength(candles);
    return useKernel(`atr:${length}`, () => createAtrKernel(length)).update(
      frame.candle,
      frame.phase,
    );
  }
  const kernel = createAtrKernel(period ?? 14);
  return candles.map((candle) => kernel.update(candle, "finalized"));
}

export function createDmiKernel(periodValue: number): CandleTaKernel<DmiPoint> {
  const period = Math.max(1, Math.floor(periodValue));
  const plusRma = new RmaKernel(period);
  const minusRma = new RmaKernel(period);
  const trRma = new RmaKernel(period);
  const adxRma = new RmaKernel(period);
  let previousHigh = Number.NaN;
  let previousLow = Number.NaN;
  let previousClose = Number.NaN;
  return {
    update(candle, phase) {
      const hasPrevious =
        Number.isFinite(previousHigh) &&
        Number.isFinite(previousLow) &&
        Number.isFinite(previousClose);
      const upMove = hasPrevious ? candle.high - previousHigh : 0;
      const downMove = hasPrevious ? previousLow - candle.low : 0;
      const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
      const priorClose = hasPrevious ? previousClose : candle.close;
      const range = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - priorClose),
        Math.abs(candle.low - priorClose),
      );
      const smoothPlus = plusRma.update(plusDm, phase);
      const smoothMinus = minusRma.update(minusDm, phase);
      const smoothTr = trRma.update(range, phase);
      const plusDI =
        Number.isFinite(smoothTr) &&
        smoothTr > Number.EPSILON &&
        Number.isFinite(smoothPlus)
          ? (100 * smoothPlus) / smoothTr
          : Number.NaN;
      const minusDI =
        Number.isFinite(smoothTr) &&
        smoothTr > Number.EPSILON &&
        Number.isFinite(smoothMinus)
          ? (100 * smoothMinus) / smoothTr
          : Number.NaN;
      const sum = plusDI + minusDI;
      const dx = Number.isFinite(sum)
        ? sum === 0
          ? 0
          : (100 * Math.abs(plusDI - minusDI)) / sum
        : Number.NaN;
      const adx = adxRma.update(dx, phase);
      if (phase === "finalized") {
        previousHigh = candle.high;
        previousLow = candle.low;
        previousClose = candle.close;
      }
      return { adx, plusDI, minusDI };
    },
  };
}

export function dmi(period: number): DmiPoint;
export function dmi(candles: readonly Candle[], period: number): DmiSeries;
export function dmi(
  candles: readonly Candle[] | number,
  period?: number,
): DmiSeries | DmiPoint {
  if (typeof candles === "number") {
    const frame = authoringFrame();
    const length = authoringLength(candles);
    return useKernel(`dmi:${length}`, () => createDmiKernel(length)).update(
      frame.candle,
      frame.phase,
    );
  }
  const kernel = createDmiKernel(period ?? 14);
  const adx: number[] = [];
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  for (const candle of candles) {
    const point = kernel.update(candle, "finalized");
    adx.push(point.adx);
    plusDI.push(point.plusDI);
    minusDI.push(point.minusDI);
  }
  return { adx, plusDI, minusDI };
}

export function createRsiKernel(periodValue: number): NumericTaKernel {
  const period = Math.max(1, Math.floor(periodValue));
  const gain = new RmaKernel(period);
  const loss = new RmaKernel(period);
  let previous = Number.NaN;
  return {
    update(value, phase) {
      const change =
        Number.isFinite(previous) && Number.isFinite(value)
          ? value - previous
          : Number.NaN;
      const avgGain = gain.update(
        Number.isFinite(change) ? Math.max(change, 0) : Number.NaN,
        phase,
      );
      const avgLoss = loss.update(
        Number.isFinite(change) ? Math.max(-change, 0) : Number.NaN,
        phase,
      );
      if (phase === "finalized" && Number.isFinite(value)) previous = value;
      if (!Number.isFinite(avgGain) || !Number.isFinite(avgLoss)) {
        return Number.NaN;
      }
      if (avgLoss === 0) return 100;
      return 100 - 100 / (1 + avgGain / avgLoss);
    },
  };
}

export function rsi(valueOrLength: number, period?: number): number;
export function rsi(values: readonly number[], period: number): number[];
export function rsi(
  values: readonly number[] | number,
  periodValue?: number,
): number[] | number {
  if (typeof values === "number")
    return numericCall("rsi", values, periodValue, createRsiKernel);
  const kernel = createRsiKernel(periodValue ?? 14);
  return values.map((value) => kernel.update(value, "finalized"));
}

class ExtremumKernel implements NumericTaKernel {
  readonly #period: number;
  readonly #mode: "highest" | "lowest";
  readonly #deque: { readonly index: number; readonly value: number }[] = [];
  #committedIndex = -1;

  constructor(period: number, mode: "highest" | "lowest") {
    this.#period = Math.max(1, Math.floor(period));
    this.#mode = mode;
  }

  update(value: number, phase: TaUpdatePhase): number {
    const candidateIndex = this.#committedIndex + 1;
    const minimumIndex = candidateIndex - this.#period + 1;
    let front = 0;
    while (
      front < this.#deque.length &&
      (this.#deque[front]?.index ?? Number.POSITIVE_INFINITY) < minimumIndex
    ) {
      front += 1;
    }
    const committedBest = this.#deque[front]?.value ?? Number.NaN;
    const result = !Number.isFinite(value)
      ? committedBest
      : !Number.isFinite(committedBest)
        ? value
        : this.#mode === "highest"
          ? Math.max(committedBest, value)
          : Math.min(committedBest, value);
    if (phase === "finalized") {
      if (front > 0) this.#deque.splice(0, front);
      if (Number.isFinite(value)) {
        while (this.#deque.length > 0) {
          const last = this.#deque.at(-1)?.value ?? Number.NaN;
          const shouldPop =
            this.#mode === "highest" ? last <= value : last >= value;
          if (!shouldPop) break;
          this.#deque.pop();
        }
        this.#deque.push({ index: candidateIndex, value });
      }
      this.#committedIndex = candidateIndex;
    }
    return result;
  }
}

export function createHighestKernel(period: number): NumericTaKernel {
  return new ExtremumKernel(period, "highest");
}

export function createLowestKernel(period: number): NumericTaKernel {
  return new ExtremumKernel(period, "lowest");
}

export function highest(valueOrLength: number, period?: number): number;
export function highest(values: readonly number[], period: number): number[];
export function highest(
  values: readonly number[] | number,
  period?: number,
): number[] | number {
  if (typeof values === "number")
    return numericCall("highest", values, period, createHighestKernel, "high");
  const kernel = createHighestKernel(period ?? 14);
  return values.map((value) => kernel.update(value, "finalized"));
}

export function lowest(valueOrLength: number, period?: number): number;
export function lowest(values: readonly number[], period: number): number[];
export function lowest(
  values: readonly number[] | number,
  period?: number,
): number[] | number {
  if (typeof values === "number")
    return numericCall("lowest", values, period, createLowestKernel, "low");
  const kernel = createLowestKernel(period ?? 14);
  return values.map((value) => kernel.update(value, "finalized"));
}

export interface CrossKernel {
  readonly update: (
    left: number,
    right: number,
    phase: TaUpdatePhase,
  ) => boolean;
}

function createCrossKernel(direction: "over" | "under"): CrossKernel {
  let previousLeft = Number.NaN;
  let previousRight = Number.NaN;
  return {
    update(left, right, phase) {
      const crossed =
        [previousLeft, previousRight, left, right].every(Number.isFinite) &&
        (direction === "over"
          ? previousLeft <= previousRight && left > right
          : previousLeft >= previousRight && left < right);
      if (phase === "finalized") {
        previousLeft = left;
        previousRight = right;
      }
      return crossed;
    },
  };
}

export function createCrossoverKernel(): CrossKernel {
  return createCrossKernel("over");
}

export function createCrossunderKernel(): CrossKernel {
  return createCrossKernel("under");
}

export function crossover(left: number, right: number): boolean;
export function crossover(
  left: readonly number[],
  right: readonly number[],
): boolean[];
export function crossover(
  left: readonly number[] | number,
  right: readonly number[] | number,
): boolean[] | boolean {
  if (typeof left === "number" && typeof right === "number") {
    return useKernel("crossover", createCrossoverKernel).update(
      left,
      right,
      authoringFrame().phase,
    );
  }
  if (typeof left === "number" || typeof right === "number")
    throw new TypeError("Cross inputs must both be scalars or arrays.");
  const kernel = createCrossoverKernel();
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) =>
    kernel.update(
      left[index] ?? Number.NaN,
      right[index] ?? Number.NaN,
      "finalized",
    ),
  );
}

export function crossunder(left: number, right: number): boolean;
export function crossunder(
  left: readonly number[],
  right: readonly number[],
): boolean[];
export function crossunder(
  left: readonly number[] | number,
  right: readonly number[] | number,
): boolean[] | boolean {
  if (typeof left === "number" && typeof right === "number") {
    return useKernel("crossunder", createCrossunderKernel).update(
      left,
      right,
      authoringFrame().phase,
    );
  }
  if (typeof left === "number" || typeof right === "number")
    throw new TypeError("Cross inputs must both be scalars or arrays.");
  const kernel = createCrossunderKernel();
  const length = Math.min(left.length, right.length);
  return Array.from({ length }, (_, index) =>
    kernel.update(
      left[index] ?? Number.NaN,
      right[index] ?? Number.NaN,
      "finalized",
    ),
  );
}

export interface TechnicalAnalysisApi {
  readonly sma: typeof sma;
  readonly ema: typeof ema;
  readonly movingAverage: typeof movingAverage;
  readonly atr: typeof atr;
  readonly dmi: typeof dmi;
  readonly rsi: typeof rsi;
  readonly trueRange: typeof trueRange;
  readonly createMovingAverageKernel: typeof createMovingAverageKernel;
  readonly createAtrKernel: typeof createAtrKernel;
  readonly createDmiKernel: typeof createDmiKernel;
  readonly createRsiKernel: typeof createRsiKernel;
  readonly highest: typeof highest;
  readonly lowest: typeof lowest;
  readonly crossover: typeof crossover;
  readonly crossunder: typeof crossunder;
  readonly createHighestKernel: typeof createHighestKernel;
  readonly createLowestKernel: typeof createLowestKernel;
  readonly createCrossoverKernel: typeof createCrossoverKernel;
  readonly createCrossunderKernel: typeof createCrossunderKernel;
}

export const ta: TechnicalAnalysisApi = Object.freeze({
  sma,
  ema,
  movingAverage,
  atr,
  dmi,
  rsi,
  trueRange,
  createMovingAverageKernel,
  createAtrKernel,
  createDmiKernel,
  createRsiKernel,
  highest,
  lowest,
  crossover,
  crossunder,
  createHighestKernel,
  createLowestKernel,
  createCrossoverKernel,
  createCrossunderKernel,
});

function authoringLength(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000)
    throw new RangeError("TA length must be an integer between 1 and 100,000.");
  return value;
}

function numericCall(
  name: string,
  valueOrPeriod: number,
  period: number | undefined,
  create: (length: number) => NumericTaKernel,
  source: "close" | "high" | "low" = "close",
): number {
  const frame = authoringFrame();
  const length = authoringLength(period ?? valueOrPeriod);
  const value = period === undefined ? frame.candle[source] : valueOrPeriod;
  return useKernel(`${name}:${length}`, () => create(length)).update(
    value,
    frame.phase,
  );
}

export function sma(value: number, period?: number): number {
  return numericCall("sma", value, period, (length) =>
    createMovingAverageKernel("sma", length),
  );
}

export function ema(value: number, period?: number): number {
  return numericCall("ema", value, period, (length) =>
    createMovingAverageKernel("ema", length),
  );
}
