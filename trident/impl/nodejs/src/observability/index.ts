import type { MetricsBackend } from './types.js';
import { NoopBackend } from './NoopBackend.js';
import { PrometheusBackend } from './PrometheusBackend.js';
import { OtelBackend } from './OtelBackend.js';

export type { MetricsBackend } from './types.js';

export function buildMetricsBackend(mode: string | undefined): MetricsBackend {
  if (mode === 'prometheus') return new PrometheusBackend();
  if (mode === 'otel') return new OtelBackend();
  return new NoopBackend();
}
