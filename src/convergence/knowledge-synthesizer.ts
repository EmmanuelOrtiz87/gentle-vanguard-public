#!/usr/bin/env node

/**
 * Knowledge Synthesizer
 * Cross-session knowledge distillation and concept mapping
 * Long-term learning and pattern recognition
 *
 * Part of Gentle-Vanguard  — Convergence Layer
 */

import { EventEmitter } from 'events';

interface KnowledgeNode {
  id: string;
  concept: string;
  category: string;
  frequency: number;
  lastAccessed: number;
  relatedConcepts: string[];
  sessions: string[];
  confidence: number;
}

interface ConceptMap {
  nodes: KnowledgeNode[];
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    relationship: string;
  }>;
}

interface SynthesisConfig {
  minFrequency: number;
  maxNodes: number;
  decayFactor: number;
  similarityThreshold: number;
}

export class KnowledgeSynthesizer extends EventEmitter {
  private config: SynthesisConfig;
  private conceptMap: ConceptMap = { nodes: [], edges: [] };
  private sessionObservations: Map<string, string[]> = new Map();

  constructor(config: Partial<SynthesisConfig> = {}) {
    super();
    this.config = {
      minFrequency: config.minFrequency || 3,
      maxNodes: config.maxNodes || 1000,
      decayFactor: config.decayFactor || 0.95,
      similarityThreshold: config.similarityThreshold || 0.8,
    };
  }

  /**
   * Process observations from a session
   */
  public processSession(sessionId: string, observations: string[]): void {
    this.sessionObservations.set(sessionId, observations);

    // Extract concepts from observations
    const concepts = this.extractConcepts(observations);

    // Update concept map
    concepts.forEach((concept) => {
      this.updateConcept(concept, sessionId);
    });

    // Find relationships between concepts
    this.updateRelationships(concepts);

    // Apply temporal decay
    this.applyDecay();

    // Emit synthesis event
    this.emit('synthesis', {
      sessionId,
      conceptsExtracted: concepts.length,
      totalNodes: this.conceptMap.nodes.length,
      timestamp: Date.now(),
    });
  }

  /**
   * Extract concepts from text using NLP techniques
   */
  private extractConcepts(observations: string[]): string[] {
    const concepts: string[] = [];
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
    ]);

    observations.forEach((obs) => {
      // Simple extraction: noun phrases and technical terms
      const words = obs
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      // Extract bigrams and trigrams
      for (let i = 0; i < words.length - 1; i++) {
        concepts.push(`${words[i]} ${words[i + 1]}`);
        if (i < words.length - 2) {
          concepts.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
        }
      }

      // Add individual technical terms
      words.forEach((w) => {
        if (this.isTechnicalTerm(w)) {
          concepts.push(w);
        }
      });
    });

    return [...new Set(concepts)]; // Remove duplicates
  }

  /**
   * Check if a word is a technical term
   */
  private isTechnicalTerm(word: string): boolean {
    const technicalPatterns = [
      /api/i,
      /config/i,
      /database/i,
      /server/i,
      /client/i,
      /async/i,
      /sync/i,
      /cache/i,
      /queue/i,
      /worker/i,
      /router/i,
      /middleware/i,
      /component/i,
      /service/i,
      /typescript/i,
      /javascript/i,
      /python/i,
      /node/i,
      /docker/i,
      /kubernetes/i,
      /aws/i,
      /azure/i,
    ];
    return technicalPatterns.some((pattern) => pattern.test(word));
  }

  /**
   * Update concept in the knowledge map
   */
  private updateConcept(concept: string, sessionId: string): void {
    const existingNode = this.conceptMap.nodes.find((n) => n.concept === concept);

    if (existingNode) {
      existingNode.frequency++;
      existingNode.lastAccessed = Date.now();
      if (!existingNode.sessions.includes(sessionId)) {
        existingNode.sessions.push(sessionId);
      }
      // Increase confidence with more observations
      existingNode.confidence = Math.min(1, existingNode.confidence + 0.05);
    } else {
      // Create new node
      const newNode: KnowledgeNode = {
        id: `concept_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        concept,
        category: this.categorizeConcept(concept),
        frequency: 1,
        lastAccessed: Date.now(),
        relatedConcepts: [],
        sessions: [sessionId],
        confidence: 0.5,
      };

      this.conceptMap.nodes.push(newNode);

      // Prune if exceeding max nodes
      if (this.conceptMap.nodes.length > this.config.maxNodes) {
        this.pruneLeastImportant();
      }
    }
  }

  /**
   * Categorize a concept
   */
  private categorizeConcept(concept: string): string {
    const categories: Record<string, RegExp[]> = {
      architecture: [/architecture/i, /design/i, /pattern/i, /structure/i],
      infrastructure: [/server/i, /database/i, /cache/i, /queue/i, /docker/i, /kubernetes/i],
      code: [/function/i, /class/i, /module/i, /component/i, /service/i],
      security: [/security/i, /auth/i, /encrypt/i, /privacy/i, /vulnerability/i],
      performance: [/performance/i, /optimize/i, /cache/i, /latency/i, /throughput/i],
    };

    for (const [category, patterns] of Object.entries(categories)) {
      if (patterns.some((p) => p.test(concept))) {
        return category;
      }
    }

    return 'general';
  }

  /**
   * Update relationships between concepts
   */
  private updateRelationships(concepts: string[]): void {
    for (let i = 0; i < concepts.length; i++) {
      for (let j = i + 1; j < concepts.length; j++) {
        const similarity = this.calculateSimilarity(concepts[i], concepts[j]);

        if (similarity > this.config.similarityThreshold) {
          this.addEdge(concepts[i], concepts[j], similarity, 'similarity');
        }

        // Check for co-occurrence
        const coOccurrence = this.calculateCoOccurrence(concepts[i], concepts[j]);
        if (coOccurrence > 0.5) {
          this.addEdge(concepts[i], concepts[j], coOccurrence, 'co-occurrence');
        }
      }
    }
  }

  /**
   * Calculate string similarity using Jaccard index
   */
  private calculateSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(' '));
    const setB = new Set(b.split(' '));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }

  /**
   * Calculate co-occurrence frequency
   */
  private calculateCoOccurrence(conceptA: string, conceptB: string): number {
    let coOccurrenceCount = 0;

    this.sessionObservations.forEach((observations, sessionId) => {
      const text = observations.join(' ').toLowerCase();
      if (text.includes(conceptA.toLowerCase()) && text.includes(conceptB.toLowerCase())) {
        coOccurrenceCount++;
      }
    });

    return coOccurrenceCount / this.sessionObservations.size;
  }

  /**
   * Add edge to concept map
   */
  private addEdge(source: string, target: string, weight: number, relationship: string): void {
    const existingEdge = this.conceptMap.edges.find(
      (e) =>
        (e.source === source && e.target === target) ||
        (e.source === target && e.target === source),
    );

    if (existingEdge) {
      existingEdge.weight = Math.max(existingEdge.weight, weight);
    } else {
      this.conceptMap.edges.push({ source, target, weight, relationship });
    }
  }

  /**
   * Apply temporal decay to concept importance
   */
  private applyDecay(): void {
    const now = Date.now();

    this.conceptMap.nodes.forEach((node) => {
      const age = now - node.lastAccessed;
      const daysSinceAccess = age / (1000 * 60 * 60 * 24);

      // Decay frequency based on time
      node.frequency *= Math.pow(this.config.decayFactor, daysSinceAccess);
    });
  }

  /**
   * Prune least important nodes
   */
  private pruneLeastImportant(): void {
    // Sort by importance (frequency * confidence)
    this.conceptMap.nodes.sort((a, b) => b.frequency * b.confidence - a.frequency * a.confidence);

    // Remove bottom 10%
    const toRemove = Math.floor(this.conceptMap.nodes.length * 0.1);
    const removed = this.conceptMap.nodes.splice(-toRemove);

    // Remove related edges
    removed.forEach((node) => {
      this.conceptMap.edges = this.conceptMap.edges.filter(
        (e) => e.source !== node.concept && e.target !== node.concept,
      );
    });
  }

  /**
   * Query knowledge base for related concepts
   */
  public queryRelated(concept: string, depth: number = 2): KnowledgeNode[] {
    const related: KnowledgeNode[] = [];
    const visited = new Set<string>();
    const queue: Array<{ concept: string; level: number }> = [{ concept, level: 0 }];

    while (queue.length > 0) {
      const { concept: currentConcept, level } = queue.shift()!;

      if (visited.has(currentConcept) || level > depth) continue;
      visited.add(currentConcept);

      // Find node
      const node = this.conceptMap.nodes.find((n) => n.concept === currentConcept);
      if (node && level > 0) {
        related.push(node);
      }

      // Find neighbors
      const neighbors = this.conceptMap.edges
        .filter((e) => e.source === currentConcept || e.target === currentConcept)
        .map((e) => (e.source === currentConcept ? e.target : e.source));

      neighbors.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push({ concept: neighbor, level: level + 1 });
        }
      });
    }

    return related;
  }

  /**
   * Get concept map statistics
   */
  public getStats(): object {
    const categories: Record<string, number> = {};
    this.conceptMap.nodes.forEach((n) => {
      categories[n.category] = (categories[n.category] || 0) + 1;
    });

    return {
      totalNodes: this.conceptMap.nodes.length,
      totalEdges: this.conceptMap.edges.length,
      totalSessions: this.sessionObservations.size,
      categories,
      averageConfidence:
        this.conceptMap.nodes.reduce((a, n) => a + n.confidence, 0) /
          this.conceptMap.nodes.length || 0,
    };
  }

  /**
   * Export knowledge graph
   */
  public exportGraph(): ConceptMap {
    return JSON.parse(JSON.stringify(this.conceptMap));
  }

  /**
   * Import knowledge graph
   */
  public importGraph(graph: ConceptMap): void {
    this.conceptMap = JSON.parse(JSON.stringify(graph));
    this.emit('import', { timestamp: Date.now(), nodes: graph.nodes.length });
  }
}

// Export singleton instance
export const knowledgeSynthesizer = new KnowledgeSynthesizer();

// CLI execution
if (require.main === module) {
  console.log('Knowledge Synthesizer ');
  console.log('Part of Gentle-Vanguard  — Convergence Layer\n');

  const synthesizer = new KnowledgeSynthesizer();

  synthesizer.on('synthesis', (event) => {
    console.log(`[${new Date().toISOString()}] Session ${event.sessionId} processed`);
    console.log(`  Concepts extracted: ${event.conceptsExtracted}`);
    console.log(`  Total nodes: ${event.totalNodes}`);
  });

  // Example usage
  console.log('Processing sample sessions...\n');

  synthesizer.processSession('session_001', [
    'Implemented caching layer for API responses',
    'Added Redis cache with TTL configuration',
    'Performance improved by 40% with caching',
  ]);

  synthesizer.processSession('session_002', [
    'Refactored authentication middleware',
    'Added JWT token validation',
    'Security audit passed with new auth layer',
  ]);

  setTimeout(() => {
    console.log('\n--- Knowledge Graph Stats ---');
    console.log(JSON.stringify(synthesizer.getStats(), null, 2));

    console.log('\n--- Query: caching ---');
    const related = synthesizer.queryRelated('caching', 1);
    related.forEach((node) => {
      console.log(
        `  - ${node.concept} (${node.category}, confidence: ${node.confidence.toFixed(2)})`,
      );
    });
  }, 100);
}
