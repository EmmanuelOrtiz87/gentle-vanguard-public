#!/usr/bin/env node

/**
 * Cross-Platform Consistency Checker
 * Ensures integration points work consistently across Windows, Linux, and macOS
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { platform } from 'os';

/**
 * Platform consistency check result
 */
interface PlatformConsistencyResult {
  platform: string;
  isConsistent: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * Cross-platform consistency checker class
 */
export class CrossPlatformConsistencyChecker {
  private readonly targetPlatforms = ['win32', 'linux', 'darwin'];

  /**
   * Check consistency of integration points across platforms
   * @returns Consistency check results
   */
  async checkConsistency(): Promise<PlatformConsistencyResult[]> {
    const results: PlatformConsistencyResult[] = [];

    for (const targetPlatform of this.targetPlatforms) {
      const result = await this.checkPlatformConsistency(targetPlatform);
      results.push(result);
    }

    return results;
  }

  /**
   * Check consistency for a specific platform
   * @param platformName Platform to check
   * @returns Consistency check result
   */
  private async checkPlatformConsistency(platformName: string): Promise<PlatformConsistencyResult> {
    const result: PlatformConsistencyResult = {
      platform: platformName,
      isConsistent: true,
      issues: [],
      recommendations: [],
    };

    try {
      // Check for platform-specific files
      const platformSpecificFiles = await this.findPlatformSpecificFiles(platformName);

      if (platformSpecificFiles.length > 0) {
        result.issues.push(`Found ${platformSpecificFiles.length} platform-specific files`);
        result.isConsistent = false;
      }

      // Check for cross-platform compatibility issues
      const compatibilityIssues = await this.checkCompatibilityIssues(platformName);

      if (compatibilityIssues.length > 0) {
        result.issues.push(...compatibilityIssues);
        result.isConsistent = false;
      }

      // Check for path separator issues
      const pathIssues = await this.checkPathSeparators(platformName);

      if (pathIssues.length > 0) {
        result.issues.push(...pathIssues);
        result.isConsistent = false;
      }

      // Add recommendations
      if (result.issues.length > 0) {
        result.recommendations.push('Review platform-specific code for consistency');
        result.recommendations.push('Use cross-platform libraries where possible');
        result.recommendations.push('Test on all target platforms regularly');
      }
    } catch (error) {
      result.issues.push(
        `Error during consistency check: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isConsistent = false;
    }

    return result;
  }

  /**
   * Find platform-specific files
   * @param platformName Platform to check
   * @returns Array of platform-specific files
   */
  private async findPlatformSpecificFiles(platformName: string): Promise<string[]> {
    const platformFiles: string[] = [];

    try {
      // Look for files with platform-specific extensions
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      for (const file of files) {
        // Check for platform-specific extensions or naming
        const basename = file.substring(file.lastIndexOf('/') + 1);
        if (
          basename.includes(`.${platformName}`) ||
          basename.includes('-win') ||
          basename.includes('-linux') ||
          basename.includes('-mac')
        ) {
          platformFiles.push(file);
        }
      }
    } catch {
      // Ignore errors in file discovery
    }

    return platformFiles;
  }

  /**
   * Check for compatibility issues
   * @param platformName Platform to check
   * @returns Array of compatibility issues
   */
  private async checkCompatibilityIssues(platformName: string): Promise<string[]> {
    const issues: string[] = [];

    try {
      // Check for shell-specific commands
      const shellCommands = ['powershell', 'cmd', 'bash', 'sh'];
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      for (const file of files) {
        if (file.endsWith('.ps1') || file.endsWith('.sh') || file.endsWith('.bat')) {
          try {
            const content = await fs.readFile(file, 'utf8');

            // Check for platform-specific commands
            for (const command of shellCommands) {
              if (
                content.includes(command) &&
                ((platformName === 'win32' && command === 'bash') ||
                  (platformName === 'linux' && command === 'powershell') ||
                  (platformName === 'darwin' && command === 'powershell'))
              ) {
                issues.push(`Potential compatibility issue in ${file} with ${command} command`);
              }
            }
          } catch {
            // Ignore file reading errors
          }
        }
      }
    } catch {
      // Ignore errors in compatibility checking
    }

    return issues;
  }

  /**
   * Check for path separator issues
   * @param platformName Platform to check
   * @returns Array of path separator issues
   */
  private async checkPathSeparators(platformName: string): Promise<string[]> {
    const issues: string[] = [];

    try {
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      for (const file of files) {
        if (file.includes('\\') || file.includes('/')) {
          // Check for hardcoded path separators
          try {
            const content = await fs.readFile(file, 'utf8');

            // Look for hardcoded Windows-style paths (backslashes)
            if (platformName === 'linux' || platformName === 'darwin') {
              if (content.includes('\\') && !content.includes('\\\\')) {
                issues.push(`Potential Windows path separator issue in ${file}`);
              }
            }

            // Look for hardcoded Unix-style paths (forward slashes) in non-Unix contexts
            if (platformName === 'win32') {
              if (content.includes('/') && !content.includes('//')) {
                issues.push(`Potential Unix path separator issue in ${file}`);
              }
            }
          } catch {
            // Ignore file reading errors
          }
        }
      }
    } catch {
      // Ignore errors in path separator checking
    }

    return issues;
  }

  /**
   * Recursively walk directory to find all files
   * @param dir Directory to walk
   * @returns Array of file paths
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const items = await fs.readdir(dir);

      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          files.push(...(await this.walkDirectory(fullPath)));
        } else {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore errors in directory walking
    }

    return files;
  }

  /**
   * Generate consistency report
   * @param results Consistency check results
   * @returns Formatted report
   */
  generateReport(results: PlatformConsistencyResult[]): string {
    const reportLines: string[] = [];

    reportLines.push('Cross-Platform Consistency Report');
    reportLines.push('==================================');
    reportLines.push('');

    let overallConsistent = true;

    for (const result of results) {
      const statusIcon = result.isConsistent ? '✅' : '❌';
      reportLines.push(
        `${statusIcon} ${result.platform}: ${result.isConsistent ? 'Consistent' : 'Inconsistent'}`,
      );

      if (result.issues.length > 0) {
        reportLines.push('Issues:');
        for (const issue of result.issues) {
          reportLines.push(`  - ${issue}`);
        }
      }

      if (result.recommendations.length > 0) {
        reportLines.push('Recommendations:');
        for (const rec of result.recommendations) {
          reportLines.push(`  - ${rec}`);
        }
      }

      reportLines.push('');

      if (!result.isConsistent) {
        overallConsistent = false;
      }
    }

    reportLines.push(
      `Overall Status: ${overallConsistent ? '✅ All platforms consistent' : '❌ Some inconsistencies found'}`,
    );

    return reportLines.join('\n');
  }

  /**
   * Check if current platform is consistent with others
   * @returns Consistency status
   */
  async checkCurrentPlatformConsistency(): Promise<boolean> {
    const currentPlatform = platform();
    const results = await this.checkConsistency();
    const currentResult = results.find((r) => r.platform === currentPlatform);

    return currentResult ? currentResult.isConsistent : false;
  }
}

// Export the checker for use in other modules
export const consistencyChecker = new CrossPlatformConsistencyChecker();

// If called directly, run consistency check
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const checker = new CrossPlatformConsistencyChecker();

  checker
    .checkConsistency()
    .then((results) => {
      console.log(checker.generateReport(results));

      const allConsistent = results.every((r) => r.isConsistent);
      if (allConsistent) {
        console.log('✅ All platforms are consistent');
      } else {
        console.log('❌ Some platforms have consistency issues');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('Consistency check error:', error);
      process.exit(1);
    });
}
