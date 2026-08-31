#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

interface WindsurfConfig {
  name?: string;
  version?: string;
  description?: string;
  workspace?: unknown;
  aiSettings?: unknown;
  toolPermissions?: unknown;
  contextManagement?: unknown;
  cascade?: unknown;
  preProcessing?: unknown;
  sessionManagement?: unknown;
  language?: unknown;
}

interface OpenCodeJson {
  references?: unknown;
  [key: string]: unknown;
}

const ROOT = path.resolve(process.cwd());

function fixOpenCodeJson(): void {
  const filePath = path.join(ROOT, 'opencode.json');
  if (!fs.existsSync(filePath)) {
    console.log('[FIX-CONFIGS] opencode.json not found, skipping');
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(raw) as OpenCodeJson;
    if ('references' in config && config.references !== undefined) {
      delete config.references;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
      console.log("Corregido opencode.json: removida propiedad 'references'");
    } else {
      console.log('[FIX-CONFIGS] opencode.json has no references property');
    }
  } catch (e) {
    console.error(`[FIX-CONFIGS] Error processing opencode.json: ${e}`);
  }
}

function fixWindsurfConfig(): void {
  const filePath = path.join(ROOT, '.windsurf', 'config.json');
  if (!fs.existsSync(filePath)) {
    console.log('[FIX-CONFIGS] .windsurf/config.json not found, skipping');
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(raw) as WindsurfConfig;
    const standardProps = [
      'name',
      'version',
      'description',
      'workspace',
      'aiSettings',
      'toolPermissions',
      'contextManagement',
      'cascade',
      'preProcessing',
      'sessionManagement',
      'language',
    ] as const;
    const newConfig: WindsurfConfig = {};
    for (const prop of standardProps) {
      if (prop in config) {
        (newConfig as Record<string, unknown>)[prop] = (config as Record<string, unknown>)[prop];
      }
    }
    fs.writeFileSync(filePath, JSON.stringify(newConfig, null, 2), 'utf-8');
    console.log('Corregido .windsurf/config.json: removidas propiedades no estándar');
  } catch (e) {
    console.error(`[FIX-CONFIGS] Error processing .windsurf/config.json: ${e}`);
  }
}

fixOpenCodeJson();
fixWindsurfConfig();
console.log('Correcciones completadas');
