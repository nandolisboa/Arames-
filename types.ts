export type OperatorName = 'Fernando' | 'Angelo' | 'Denerval';
export type GaugeType = '3,8' | '4,2' | '5,0' | '6,0';
export type PackageKind = 'PACOTE' | 'AMARRADO' | 'CAIXA' | 'M.LIVRE';
export type WeightSource = 'ETIQUETA' | 'BALANCA' | 'AMBOS';
export type DateFilter = 'all' | 'today' | 'month';
export type AppTab = 'production' | 'coils';

export interface AppProfile {
  display_name: string;
  role: string;
}

export interface ProductionRow {
  id: string | number;
  production_date: string;
  operator: OperatorName | string;
  gauge: GaugeType | string;
  measure: string;
  package_type: PackageKind | string;
  pieces_per_unit: number;
  units: number;
  total_pieces: number;
  created_at: string;
}

export interface CoilRow {
  id: string | number;
  gauge: GaugeType | string;
  manufacturer: string;
  weight_kg: number;
  weight_label_kg?: number | null;
  weight_scale_kg?: number | null;
  weight_source: WeightSource | string;
  invoice_number: string | null;
  invoice_series: string | null;
  created_at: string;
}

export type GoalTargets = Record<OperatorName, number>;
