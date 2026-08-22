---
name: semantic-skill-matcher
description: >
  Semantic skill matching using embeddings for intelligent routing. Trigger: "semantic match", "find
  skill", "skill routing", "embeddings".
metadata:
  source: GV-native
---

## When to Use

- Routing tasks to the most relevant skill based on semantic meaning
- Finding skills by description rather than exact keywords
- Learning from user overrides ("always use X for Y")
- Providing intelligent suggestions when multiple skills match

## 📋 Technical Deliverables

### Skill Embedding Cache

```json
// .session/skill-embeddings.json
{
  "version": "1.0",
  "last_updated": "2026-05-02T15:30:00Z",
  "embeddings": {
    "angular-spa-skill": {
      "vector": [0.123, 0.456, ...],
      "keywords": ["angular", "spa", "signals", "zoneless"],
      "description": "Angular 19+ SPA patterns"
    },
    "sdd-apply": {
      "vector": [0.789, 0.012, ...],
      "keywords": ["implement", "code", "apply", "tasks"],
      "description": "Implement code from task definitions"
    }
  }
}
```

### Semantic Match Result

```json
{
  "query": "create Angular component with signals",
  "matches": [
    {
      "skill": "angular-spa-skill",
      "score": 0.92,
      "reason": "Strong match: angular + signals + component"
    },
    {
      "skill": "angular-core",
      "score": 0.78,
      "reason": "Match: angular + component"
    }
  ],
  "selected": "angular-spa-skill"
}
```

## 🔄 Workflow Process

### Step1: Query Analysis

- Extract key concepts from the user's request
- Identify task type (implement, design, test, document)
- Identify tech stack (Angular, React, Go, Python)
- Build semantic query vector

### Step2: Embedding Lookup

- Load embedding cache from `.session/skill-embeddings.json`
- Compute cosine similarity between query and each skill
- Sort by relevance score (0.0 to 1.0)
- Return top 3 matches with reasons

### Step3: User Override Learning

- If user overrides selection ("use X instead"), record preference
- Store in `config/semantic-overrides.json`
- Future queries for similar tasks will prefer overridden skill
- Format: `{"query_pattern": "angular component", "preferred_skill": "angular-spa-skill"}`

## 🎯 Success Metrics

You're successful when:

- **Match Accuracy**: 90%+ of queries match the correct skill
- **Response Time**: <500ms for semantic search (with cache)
- **Override Learning**: 100% of user overrides recorded and applied
- **Context7 Boost**: 20%+ accuracy improvement when Context7 available
- **Coverage**: 95%+ of skills have embeddings cached

## 💭 Communication Style

- **Be semantic**: "Query: 'Angular component' → angular-spa-skill (0.92), angular-core (0.78)"
- **Focus on relevance**: "Top match: angular-spa-skill — covers signals + zoneless SPA"
- **Think learning**: "User override recorded: 'use react-19 for components' → learned"
- **Ensure clarity**: "Match: 🟢 angular-spa (0.92) | 🟡 angular-core (0.78) | ⚫ sdd-apply (0.45)"

## 🔄 Learning & Memory

---

> **Referencia detallada**: [eferences/detail.md](references/detail.md)
