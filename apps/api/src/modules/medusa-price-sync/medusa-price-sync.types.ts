/**
 * Medusa price sync types. Redmine #166532 (HLA rows 4 and 7).
 *
 * Rates are `string` everywhere in this module, never `number`. UKSS stores them
 * to 8 decimal places and float64 cannot hold those exactly, so a single Number()
 * on the path from MySQL to Medusa makes generated prices wobble by a penny
 * between runs — which defeats the skip-unchanged-variant optimisation the whole
 * schedule depends on. The type is the enforcement.
 */

/** One currency from `ukssmain.currencies`, normalised. */
export type RateEntry = {
  /** Lowercase ISO code, as Medusa stores it. */
  currency: string
  /** "1 GBP = rate <currency>", as an exact decimal string. */
  rate: string
  /** Minor-unit digits from UKSS. */
  decimalPlaces: number
  lastUpdated: Date | null
}

/** An immutable, validated rate snapshot — the unit a run is built from. */
export type RateSnapshot = {
  baseCurrency: string
  /** currency -> decimal-string rate, base currency excluded. */
  rates: Record<string, string>
  /** currency -> minor-unit digits. */
  decimals: Record<string, number>
  /** The OLDEST last_updated among the included rates, i.e. worst case age. */
  ratesAsOf: Date
  ageHours: number
  /**
   * True when the rates already carry UKSS's commercial margin.
   *
   * Always true by the time a snapshot leaves this module: if the source is
   * declared not to include it, `marginPercent` is applied here so exactly one
   * place ever multiplies by it. Medusa refuses `margin_included: false`.
   */
  marginIncluded: true
  /** The margin this process applied itself, "0" when the source already had it. */
  marginAppliedPercent: string
  /** SHA-256 over the normalised snapshot. Every batch of a run reuses it. */
  hash: string
  /** Currencies present in UKSS but excluded, with why. */
  excluded: Array<{ currency: string; reason: string }>
}

export type RunState = {
  id: string
  status: string
  rate_hash: string
  rates_as_of: string
  target_currencies: string[]
  cursor: string | null
  batch_size: number
  dry_run: boolean
  counters?: Record<string, number>
}

export type BatchResult = {
  run_id: string
  status: string
  replayed?: boolean
  batch: {
    variants_scanned: number
    variants_processed: number
    prices_created: number
    prices_updated: number
    prices_unchanged: number
    prices_skipped: number
    prices_failed: number
  }
  skipped_reasons?: Record<string, number>
  next_cursor: string | null
  has_more: boolean
}

export type SyncOptions = {
  dryRun: boolean
  batchSize: number
  /** Stop after this many batches. 0 = no limit. For smoke tests. */
  maxBatches: number
  maxRateAgeHours: number
  /** Refuse the snapshot if any rate moved more than this since the last run. */
  maxRateMovementPercent: number
  /** Extra margin this process must apply because the source lacks it. */
  marginPercent: string
  timeoutMs: number
  maxRetries: number
}

export type SyncResult = {
  runId: string | null
  rateHash: string
  startedAt: string
  completedAt: string
  durationMs: number
  batches: number
  totals: BatchResult["batch"]
  cursor: string | null
  completed: boolean
  errors: string[]
}
