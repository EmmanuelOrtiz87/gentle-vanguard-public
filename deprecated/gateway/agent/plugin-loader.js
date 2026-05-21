import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');

const loaded = { defs: [], executors: new Map() };

export function getPluginDir() {
  if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  return PLUGINS_DIR;
}

export async function scanPlugins() {
  const dir = getPluginDir();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const tools = [];
  const executors = new Map();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const toolPath = path.join(dir, entry.name, 'tool.js');
    const manifestPath = path.join(dir, entry.name, 'manifest.json');
    if (!fs.existsSync(toolPath)) continue;

    try {
      let manifest = {};
      if (fs.existsSync(manifestPath)) {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      }

      const mod = await import(`file://${toolPath.replace(/\\/g, '/')}`);
      const pluginName = entry.name;

      if (mod.definition) {
        const def = {
          name: `plugin_${pluginName}`,
          description: mod.definition.description || `Plugin: ${pluginName}`,
          parameters: mod.definition.parameters || { type: 'object', properties: {}, required: [] },
          plugin: pluginName,
        };
        tools.push(def);
        executors.set(`plugin_${pluginName}`, mod.execute || (() => ({ success: false, output: 'No execute fn' })));
      }

      if (mod.definitions && Array.isArray(mod.definitions)) {
        for (const d of mod.definitions) {
          const def = {
            name: `plugin_${pluginName}_${d.name}`,
            description: d.description || `Plugin ${pluginName}: ${d.name}`,
            parameters: d.parameters || { type: 'object', properties: {}, required: [] },
            plugin: pluginName,
          };
          tools.push(def);
          executors.set(`plugin_${pluginName}_${d.name}`, d.execute || (() => ({ success: false, output: 'No execute fn' })));
        }
      }

      if (manifest.title) {
        const existing = tools.find(t => t.plugin === pluginName);
        if (existing) existing.title = manifest.title;
      }
    } catch (err) {
      console.error(`plugin-loader: error loading ${entry.name}: ${err.message}`);
    }
  }

  loaded.defs = tools;
  loaded.executors = executors;
  return { defs: tools, executors };
}

export function getPluginTools() {
  return loaded.defs || [];
}

export function getPluginExecutor(name) {
  return loaded.executors.get(name);
}

export function reloadPlugins() {
  loaded.defs = [];
  loaded.executors = new Map();
  return scanPlugins();
}
