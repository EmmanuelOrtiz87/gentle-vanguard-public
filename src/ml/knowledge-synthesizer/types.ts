export interface SynthArgs {
  mode: 'synthesize' | 'map' | 'trends' | 'gaps';
  output: 'json' | 'md';
  quiet: boolean;
  dryRun: boolean;
}

export interface KnowledgeConcept {
  id: string;
  name: string;
  category: string;
  firstSeen: string;
  lastSeen: string;
  frequency: number;
  sources: string[];
  confidence: number; // 0..1
  relatedConcepts: string[];
}

export interface KnowledgeRelationship {
  from: string;
  to: string;
  type: 'depends_on' | 'implements' | 'conflicts_with' | 'extends' | 'related_to' | 'precedes';
  confidence: number;
  evidence: string[];
}

export interface TrendPoint {
  date: string;
  conceptCount: number;
  newConcepts: number;
  activeSessions: number;
}

export interface TrendAnalysis {
  concept: string;
  windowDays: number;
  points: TrendPoint[];
  trajectory: 'growing' | 'stable' | 'declining' | 'sporadic';
  acceleration: number; // slope
  recommendation: string;
}

export interface KnowledgeGap {
  area: string;
  description: string;
  evidenceCount: number;
  evidence: string[];
  suggestedSource: string;
  priority: 'low' | 'medium' | 'high';
}

export interface PatternRef {
  id: string;
  type: string;
  title: string;
  severity: string;
}

export interface InsightRef {
  category: string;
  finding: string;
  confidence?: number;
}

export interface SynthOutput {
  timestamp: string;
  sessionCount: number;
  dateRange: { from: string; to: string };
  patterns?: PatternRef[];
  insights?: InsightRef[];
  concepts: KnowledgeConcept[];
  relationships: KnowledgeRelationship[];
  trends: TrendAnalysis[];
  gaps: KnowledgeGap[];
  qualityScore: number;
}
