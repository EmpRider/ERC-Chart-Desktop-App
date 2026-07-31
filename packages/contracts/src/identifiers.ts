declare const providerIdBrand: unique symbol;
declare const feedIdBrand: unique symbol;
declare const instrumentIdBrand: unique symbol;
declare const timeframeIdBrand: unique symbol;

export type ProviderId = string & { readonly [providerIdBrand]: "ProviderId" };
export type FeedId = string & { readonly [feedIdBrand]: "FeedId" };
export type InstrumentId = string & {
  readonly [instrumentIdBrand]: "InstrumentId";
};
export type TimeframeId = string & {
  readonly [timeframeIdBrand]: "TimeframeId";
};
