/** Shared Host and browser configuration validation. */
import z from '@deepseek-ai/schemastery'
/** Scheduler snapshot refresh configuration. */
export interface Config {
  /** Interval between scheduler document reads in milliseconds. */
  refreshIntervalMs: number
}
/** Refresh frequency is configurable for remote or high-latency Hosts. */
export const Config: z<Config> = z.object({ refreshIntervalMs: z.natural().min(100).default(1000) })
