import * as ts from 'typescript';
import { DEFAULT_CONFIG, getLanguageService } from './language-service.js';
import {
  resolveFilePath,
  getOffset,
  getLineColFromPosition,
  getQuickInfoDisplayString,
} from './position.js';

// ── Tool Handlers ────────────────────────────────────────────────────────────

export function handleGoToDefinition(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const offset = getOffset(cache.service, resolved, line, col);
  const defs = cache.service.getDefinitionAtPosition(resolved, offset);
  if (!defs || defs.length === 0) {
    return { found: false, message: 'No definition found' };
  }

  const def = defs[0];
  const sf = cache.service.getProgram()?.getSourceFile(def.fileName);
  const pos = sf ? getLineColFromPosition(sf, def.textSpan.start) : { line: 0, col: 0 };

  // Get display string via quickInfo
  const quickInfo = cache.service.getQuickInfoAtPosition(def.fileName, def.textSpan.start);

  return {
    found: true,
    symbol: def.fileName,
    file: def.fileName,
    line: pos.line,
    col: pos.col,
    length: def.textSpan.length,
    displayString: quickInfo ? getQuickInfoDisplayString(quickInfo) : '',
    kind: def.kind,
  };
}

export function handleFindReferences(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  // First get definition to find the actual symbol position
  const offset = getOffset(cache.service, resolved, line, col);
  const defs = cache.service.getDefinitionAtPosition(resolved, offset);
  if (!defs || defs.length === 0) {
    return { found: false, message: 'No symbol at position to find references for' };
  }

  // Use the first definition as the target for findReferences
  const def = defs[0];
  const refs = cache.service.findReferences(def.fileName, def.textSpan.start);

  if (!refs || refs.length === 0) {
    return { found: false, message: 'No references found' };
  }

  const entries: Array<{
    file: string;
    line: number;
    col: number;
    text: string;
    isDefinition: boolean;
  }> = [];

  for (const ref of refs) {
    for (const entry of ref.references) {
      if (entries.length >= DEFAULT_CONFIG.maxReferences) break;
      const sf = cache.service.getProgram()?.getSourceFile(entry.fileName);
      const pos = sf ? getLineColFromPosition(sf, entry.textSpan.start) : { line: 0, col: 0 };
      const text =
        entry.textSpan.length > 0 && sf
          ? sf.text
              .substring(
                entry.textSpan.start,
                Math.min(entry.textSpan.start + entry.textSpan.length + 40, sf.text.length),
              )
              .trim()
          : '';

      entries.push({
        file: entry.fileName,
        line: pos.line,
        col: pos.col,
        text: text.slice(0, 80),
        isDefinition: entry.isDefinition ?? false,
      });
    }
  }

  return {
    found: entries.length > 0,
    symbolName: refs[0]?.definition?.name ?? 'unknown',
    total: entries.length,
    truncated: entries.length >= DEFAULT_CONFIG.maxReferences,
    references: entries,
  };
}

export function handleHoverInfo(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const quickInfo = cache.service.getQuickInfoAtPosition(resolved, offset);
  if (!quickInfo) {
    return { found: false, message: 'No info at position' };
  }

  const displayString = getQuickInfoDisplayString(quickInfo);
  const documentation = quickInfo.documentation ?? [];
  const tags = quickInfo.tags ?? [];

  return {
    found: true,
    displayString,
    documentation: documentation
      .map((c) => (c.kind === 'text' ? c.text : c.kind === 'code' ? `\`${c.text}\`` : c.text))
      .join('\n'),
    tags: tags.map((t) => `@${t.name} ${t.text ?? ''}`),
    kind: quickInfo.kind,
    kindModifiers: quickInfo.kindModifiers,
  };
}

export function handleCompletions(filePath: string, line: number, col: number, prefix?: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const details = cache.service.getCompletionsAtPosition(resolved, offset, {
    includeExternalModuleExports: false,
    includeInsertTextCompletions: false,
    triggerCharacter: undefined,
  });

  if (!details || details.entries.length === 0) {
    return { found: false, message: 'No completions at position' };
  }

  let entries = details.entries;
  if (prefix) {
    const q = prefix.toLowerCase();
    entries = entries.filter((e) => e.name.toLowerCase().startsWith(q));
  }

  entries = entries.slice(0, DEFAULT_CONFIG.maxCompletions);

  return {
    found: entries.length > 0,
    total: entries.length,
    isNewIdentifierLocation: details.isNewIdentifierLocation ?? false,
    entries: entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      kindModifiers: e.kindModifiers ?? '',
      sortText: e.sortText,
      isRecommended: e.sortText?.startsWith('15') ?? false,
      replacementSpan: e.replacementSpan
        ? {
            start: e.replacementSpan.start,
            length: e.replacementSpan.length,
          }
        : undefined,
    })),
  };
}

export function handleDiagnostics(filePath: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const syntacticDiags = cache.service.getSyntacticDiagnostics(resolved);
  const semanticDiags = cache.service.getSemanticDiagnostics(resolved);
  const suggestionDiags = cache.service.getSuggestionDiagnostics(resolved);

  const allDiags = [...syntacticDiags, ...semanticDiags, ...suggestionDiags].slice(
    0,
    DEFAULT_CONFIG.maxDiagnostics,
  );

  if (allDiags.length === 0) {
    return { hasDiagnostics: false, diagnostics: [] };
  }

  return {
    hasDiagnostics: true,
    total: allDiags.length,
    truncated: allDiags.length >= DEFAULT_CONFIG.maxDiagnostics,
    diagnostics: allDiags.map((d) => {
      const file = d.file;
      const pos =
        file && d.start !== undefined ? getLineColFromPosition(file, d.start) : { line: 0, col: 0 };
      return {
        category:
          d.category === ts.DiagnosticCategory.Error
            ? 'error'
            : d.category === ts.DiagnosticCategory.Warning
              ? 'warning'
              : 'suggestion',
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        line: pos.line,
        col: pos.col,
        source: d.source ?? 'typescript',
        relatedInformation: d.relatedInformation?.map((r) => ({
          message: ts.flattenDiagnosticMessageText(r.messageText, '\n'),
          file: r.file?.fileName,
          line: r.file && r.start !== undefined ? getLineColFromPosition(r.file, r.start).line : 0,
        })),
      };
    }),
  };
}

export function handleSignatureHelp(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const sigs = cache.service.getSignatureHelpItems(resolved, offset, {
    triggerReason: { kind: 'invoked' },
  });

  if (!sigs) {
    return { found: false, message: 'No signature help at position' };
  }

  return {
    found: true,
    selectedItemIndex: sigs.selectedItemIndex,
    argumentIndex: sigs.argumentIndex,
    argumentCount: sigs.argumentCount,
    items: sigs.items.map((item) => ({
      signature: printSignature(item),
      prefixDisplayParts: item.prefixDisplayParts?.map((p) => p.text).join('') ?? '',
      separator: item.separatorDisplayParts?.map((p) => p.text).join('') ?? ', ',
      parameters: item.parameters.map((p) => ({
        name: p.name,
        displayParts: p.displayParts?.map((dp) => dp.text).join('') ?? '',
        documentation:
          p.documentation?.map((c) => (c.kind === 'text' ? c.text : '')).join('\n') ?? '',
        isOptional: p.isOptional ?? false,
      })),
      documentation:
        item.documentation?.map((c) => (c.kind === 'text' ? c.text : '')).join('\n') ?? '',
    })),
  };
}

export function printSignature(item: ts.SignatureHelpItem): string {
  const parts = [...(item.prefixDisplayParts ?? [])];
  for (let i = 0; i < item.parameters.length; i++) {
    if (i > 0) parts.push(...(item.separatorDisplayParts ?? []));
    parts.push(...item.parameters[i].displayParts);
    if (item.parameters[i].isOptional) parts.push({ text: '?', kind: 'punctuation' });
  }
  return parts.map((p) => p.text).join('');
}

export function handleSymbolSearch(query: string, maxResults: number) {
  const cache = getLanguageService();
  const program = cache.service.getProgram();

  const navToItems = cache.service.getNavigateToItems(query, maxResults, undefined, undefined);

  if (!navToItems || navToItems.length === 0) {
    return { found: false, symbols: [] };
  }

  return {
    found: true,
    total: navToItems.length,
    truncated: navToItems.length >= maxResults,
    symbols: navToItems.map((item) => {
      // Compute line/col from textSpan.start using source file
      let line = 0,
        col = 0;
      if (program) {
        const sf = program.getSourceFile(item.fileName);
        if (sf) {
          const lc = getLineColFromPosition(sf, item.textSpan.start);
          line = lc.line;
          col = lc.col;
        }
      }
      return {
        name: item.name,
        kind: item.kind,
        kindModifiers: item.kindModifiers ?? '',
        file: item.fileName,
        line,
        col,
        containerName: item.containerName ?? undefined,
        containerKind: item.containerKind ?? undefined,
        matchKind: item.matchKind,
      };
    }),
  };
}

export function handleFileSymbols(filePath: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const tree = cache.service.getNavigationTree(resolved);
  if (!tree) {
    return { found: false, message: 'No navigation tree available' };
  }

  const program = cache.service.getProgram();
  const sf = program?.getSourceFile(resolved);

  function getSpanPos(span: ts.TextSpan): {
    line: number;
    col: number;
    endLine: number;
    endCol: number;
  } {
    if (!sf) return { line: 0, col: 0, endLine: 0, endCol: 0 };
    const start = getLineColFromPosition(sf, span.start);
    const end = getLineColFromPosition(sf, span.start + span.length);
    return { line: start.line, col: start.col, endLine: end.line, endCol: end.col };
  }

  function flattenTree(
    node: ts.NavigationTree,
    depth: number = 0,
  ): Array<{
    name: string;
    kind: string;
    kindModifiers: string;
    line: number;
    col: number;
    endLine: number;
    endCol: number;
    depth: number;
    hasChildren: boolean;
  }> {
    const result: Array<{
      name: string;
      kind: string;
      kindModifiers: string;
      line: number;
      col: number;
      endLine: number;
      endCol: number;
      depth: number;
      hasChildren: boolean;
    }> = [];

    const span = node.spans?.[0]
      ? getSpanPos(node.spans[0])
      : { line: 0, col: 0, endLine: 0, endCol: 0 };
    result.push({
      name: node.text,
      kind: node.kind,
      kindModifiers: node.kindModifiers ?? '',
      line: span.line,
      col: span.col,
      endLine: span.endLine,
      endCol: span.endCol,
      depth,
      hasChildren: (node.childItems?.length ?? 0) > 0,
    });

    if (node.childItems && depth < 3) {
      for (const child of node.childItems) {
        result.push(...flattenTree(child, depth + 1));
      }
    }

    return result;
  }

  const symbols = flattenTree(tree).filter((s) => s.depth <= 2); // Limit depth

  return {
    found: symbols.length > 0,
    total: symbols.length,
    file: resolved,
    symbols,
  };
}
