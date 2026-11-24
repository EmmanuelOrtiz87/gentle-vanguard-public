export interface PageLite {
  id?: string;
  title: string;
  lastModified: string | null;
  created?: string | null;
  status?: string | null;
}

export interface WindowCounts {
  d30: number;
  d90: number;
  y1: number;
  all: number;
  open: number;
}

export type TermCounts = Record<string, WindowCounts>;

export interface IssueSample {
  key: string;
  summary: string;
  created: string;
  status: string;
  priority: string;
}

interface WeekSeries {
  system: string;
  series: number[];
}

export interface ExtraSnapshot {
  prio30: Record<string, number>;
  weeks: WeekSeries[];
  samples: Record<string, IssueSample[]>;
}

export interface TreeNode {
  id: string;
  title: string;
  children: Array<{ id: string; title: string }>;
  childTotal: number;
}

export interface SpaceInfo {
  key: string;
  name: string;
}

export interface OtherSpace {
  key: string;
  name: string;
  pages: PageLite[];
}

export interface AnalyticsProbe {
  endpoint: string;
  available: boolean;
  checkedAt: string;
  pagesChecked: number;
  lastViewedAt?: string | null;
}

/** Censo Censor: estructura estable pero amplia; se consume por secciones. */
type CensorCensus = Record<string, any>;

export interface ReportBundle {
  pages: PageLite[];
  dgo: PageLite[];
  field: { options?: string[]; counts: TermCounts };
  kw: TermCounts;
  totals: WindowCounts;
  extra: ExtraSnapshot;
  census: CensorCensus;
  tree: TreeNode[];
  others?: OtherSpace[];
  analytics?: AnalyticsProbe;
  stamp?: string;
  now?: string;
}
