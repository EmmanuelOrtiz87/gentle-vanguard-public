#!/usr/bin/env node

/**
 * Enhanced Tool Detection System
 * Improves tool detection to handle newer tools and frameworks
 */

import { runSyncShell } from './run-command.js';
import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Tool detection result
 */
interface ToolDetectionResult {
  name: string;
  version: string;
  path: string;
  detected: boolean;
  compatibility: 'compatible' | 'incompatible' | 'unknown';
  notes?: string[];
}

/**
 * Enhanced tool detector class
 */
export class EnhancedToolDetector {
  /**
   * Detect available tools in the system
   * @returns Array of detected tools
   */
  async detectTools(): Promise<ToolDetectionResult[]> {
    const tools = [
      { name: 'node', command: 'node --version' },
      { name: 'npm', command: 'npm --version' },
      { name: 'pnpm', command: 'pnpm --version' },
      { name: 'git', command: 'git --version' },
      { name: 'docker', command: 'docker --version' },
      { name: 'powershell', command: 'powershell -Command "$PSVersionTable.PSVersion"' },
      { name: 'typescript', command: 'tsc --version' },
      { name: 'eslint', command: 'eslint --version' },
      { name: 'jest', command: 'jest --version' },
      { name: 'vite', command: 'vite --version' },
    ];

    const results: ToolDetectionResult[] = [];

    for (const tool of tools) {
      try {
        const result = await this.detectSingleTool(tool);
        results.push(result);
      } catch (error) {
        results.push({
          name: tool.name,
          version: 'unknown',
          path: 'unknown',
          detected: false,
          compatibility: 'unknown',
          notes: [`Detection failed: ${error instanceof Error ? error.message : String(error)}`],
        });
      }
    }

    // Add custom tools that might be in the project
    const customTools = await this.detectCustomTools();
    results.push(...customTools);

    return results;
  }

  /**
   * Detect a single tool
   * @param tool Tool definition
   * @returns Tool detection result
   */
  private async detectSingleTool(tool: {
    name: string;
    command: string;
  }): Promise<ToolDetectionResult> {
    try {
      // Try to get version information
      const versionOutput = runSyncShell(tool.command, { timeout: 5000 }).stdout;

      // Extract version from output
      let version = 'unknown';
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        version = versionMatch[0];
      }

      // Try to get the tool path
      let path = 'unknown';
      try {
        const pathOutput = runSyncShell(`which ${tool.name} || where ${tool.name}`, {
          timeout: 500,
        }).stdout;
        path = pathOutput.trim();
      } catch {
        // If path detection fails, keep 'unknown'
      }

      // Determine compatibility based on version
      const compatibility = this.determineCompatibility(tool.name, version);

      return {
        name: tool.name,
        version,
        path,
        detected: true,
        compatibility,
        notes: [`Detected version: ${version}`],
      };
    } catch (error) {
      return {
        name: tool.name,
        version: 'unknown',
        path: 'unknown',
        detected: false,
        compatibility: 'unknown',
        notes: [`Tool not detected: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }

  /**
   * Detect custom tools in the project
   * @returns Array of custom tool detections
   */
  private async detectCustomTools(): Promise<ToolDetectionResult[]> {
    const results: ToolDetectionResult[] = [];

    try {
      // Look for custom tool scripts in the project
      const scriptsDir = join(process.cwd(), 'scripts');
      const stats = await fs.stat(scriptsDir);

      if (stats.isDirectory()) {
        const files = await fs.readdir(scriptsDir);
        for (const file of files) {
          if (file.endsWith('.ps1') || file.endsWith('.ts') || file.endsWith('.js')) {
            // Simple heuristic: if it's a script that might be a tool
            if (file.includes('tool') || file.includes('util') || file.includes('helper')) {
              results.push({
                name: file.replace(/\.(ps1|ts|js)$/, ''),
                version: 'custom',
                path: join(scriptsDir, file),
                detected: true,
                compatibility: 'compatible',
                notes: ['Custom tool detected'],
              });
            }
          }
        }
      }
    } catch {
      // Ignore errors in custom tool detection
    }

    return results;
  }

  /**
   * Determine tool compatibility
   * @param toolName Name of the tool
   * @param version Version string
   * @returns Compatibility status
   */
  private determineCompatibility(
    toolName: string,
    version: string,
  ): 'compatible' | 'incompatible' | 'unknown' {
    // Simple compatibility logic - in a real implementation this would be more sophisticated
    if (version === 'unknown') {
      return 'unknown';
    }

    // Convert version to comparable format
    const versionParts = version.split('.').map(Number);
    if (versionParts.length < 2) {
      return 'unknown';
    }

    const major = versionParts[0];
    const minor = versionParts[1];

    // Define minimum required versions
    const minVersions: Record<string, { major: number; minor: number }> = {
      node: { major: 16, minor: 0 },
      npm: { major: 8, minor: 0 },
      pnpm: { major: 7, minor: 0 },
      git: { major: 2, minor: 0 },
      typescript: { major: 4, minor: 0 },
    };

    if (minVersions[toolName]) {
      const min = minVersions[toolName];
      if (major > min.major || (major === min.major && minor >= min.minor)) {
        return 'compatible';
      } else {
        return 'incompatible';
      }
    }

    return 'compatible'; // Default to compatible if no specific requirements
  }

  /**
   * Validate tool compatibility with current system
   * @param toolName Name of the tool to validate
   * @returns Validation result
   */
  async validateTool(toolName: string): Promise<{ valid: boolean; message: string }> {
    try {
      const tools = await this.detectTools();
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return {
          valid: false,
          message: `Tool '${toolName}' not found`,
        };
      }

      if (!tool.detected) {
        return {
          valid: false,
          message: `Tool '${toolName}' not detected in system`,
        };
      }

      if (tool.compatibility === 'incompatible') {
        return {
          valid: false,
          message: `Tool '${toolName}' version ${tool.version} is incompatible`,
        };
      }

      return {
        valid: true,
        message: `Tool '${toolName}' is compatible (version: ${tool.version})`,
      };
    } catch (error) {
      return {
        valid: false,
        message: `Error validating tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Generate tool detection report
   * @param tools Detected tools
   * @returns Formatted report
   */
  generateReport(tools: ToolDetectionResult[]): string {
    const reportLines: string[] = [];

    reportLines.push('Enhanced Tool Detection Report');
    reportLines.push('==============================');
    reportLines.push('');

    const compatibleTools = tools.filter((t) => t.compatibility === 'compatible');
    const incompatibleTools = tools.filter((t) => t.compatibility === 'incompatible');
    const undetectedTools = tools.filter((t) => !t.detected);

    reportLines.push(`Total tools detected: ${tools.length}`);
    reportLines.push(`Compatible tools: ${compatibleTools.length}`);
    reportLines.push(`Incompatible tools: ${incompatibleTools.length}`);
    reportLines.push(`Undetected tools: ${undetectedTools.length}`);
    reportLines.push('');

    reportLines.push('Tool Details:');
    reportLines.push('-------------');

    for (const tool of tools) {
      const statusIcon = tool.detected ? (tool.compatibility === 'compatible' ? '✅' : '⚠️') : '❌';

      reportLines.push(`${statusIcon} ${tool.name} (${tool.version})`);
      reportLines.push(`   Path: ${tool.path}`);
      reportLines.push(`   Status: ${tool.compatibility}`);

      if (tool.notes && tool.notes.length > 0) {
        for (const note of tool.notes) {
          reportLines.push(`   Note: ${note}`);
        }
      }
      reportLines.push('');
    }

    return reportLines.join('\n');
  }
}

// Export the detector for use in other modules
export const toolDetector = new EnhancedToolDetector();

// If called directly, run detection
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const detector = new EnhancedToolDetector();

  detector
    .detectTools()
    .then((tools) => {
      console.log(detector.generateReport(tools));

      // Check for incompatible tools
      const incompatible = tools.filter((t) => t.compatibility === 'incompatible');
      if (incompatible.length > 0) {
        console.log('⚠️  Incompatible tools detected:');
        for (const tool of incompatible) {
          console.log(`  - ${tool.name} (${tool.version})`);
        }
      }
    })
    .catch((error) => {
      console.error('Tool detection error:', error);
      process.exit(1);
    });
}
