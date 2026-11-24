import type { CoilRow } from '../types';

export function formatCoilWeights(c: CoilRow): string {
  const fmt = (n: number) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
  if (c.weight_source === 'AMBOS' && c.weight_label_kg != null && c.weight_scale_kg != null) {
    return `Etiqueta: ${fmt(c.weight_label_kg)} / Balança: ${fmt(c.weight_scale_kg)}`;
  }
  return fmt(c.weight_kg);
}


/** Compact labels for coil weight values in PDF and print reports. */
export function formatCoilWeightsForReport(c: CoilRow): string {
  const full = formatCoilWeights(c);
  if (c.weight_source === 'AMBOS' && c.weight_label_kg != null && c.weight_scale_kg != null) {
    return full.replace('Etiqueta:', 'Etiq.:').replace('Balança:', 'Bal.:');
  }
  if (c.weight_source === 'ETIQUETA') return `Etiq. ${full}`;
  if (c.weight_source === 'BALANCA') return `Bal. ${full}`;
  return full;
}
