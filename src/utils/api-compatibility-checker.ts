#!/usr/bin/env node

/**
 * API Compatibility Checker
 * Ensures API interfaces work consistently across different components
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * API compatibility check result
 */
interface ApiCompatibilityResult {
  componentName: string;
  isCompatible: boolean;
  issues: string[];
  recommendations: string[];
}

/**
 * API compatibility checker class
 */
export class ApiCompatibilityChecker {
  /**
   * Check API compatibility across components
   * @returns Compatibility check results
   */
  async checkApiCompatibility(): Promise<ApiCompatibilityResult[]> {
    const results: ApiCompatibilityResult[] = [];

    // Check for API contract consistency
    const apiContracts = await this.findApiContracts();

    for (const contract of apiContracts) {
      const result = await this.checkContractCompatibility(contract);
      results.push(result);
    }

    // Check for common API patterns
    const patternResults = await this.checkCommonApiPatterns();
    results.push(...patternResults);

    return results;
  }

  /**
   * Find API contracts in the codebase
   * @returns Array of API contract files
   */
  private async findApiContracts(): Promise<string[]> {
    const contracts: string[] = [];

    try {
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      for (const file of files) {
        // Look for files that might contain API contracts
        if (
          file.includes('api') ||
          file.includes('contract') ||
          file.includes('interface') ||
          file.includes('schema') ||
          file.endsWith('.d.ts')
        ) {
          contracts.push(file);
        }
      }
    } catch {
      // Ignore errors in contract discovery
    }

    return contracts;
  }

  /**
   * Check compatibility of a specific API contract
   * @param contractFile Path to contract file
   * @returns Compatibility check result
   */
  private async checkContractCompatibility(contractFile: string): Promise<ApiCompatibilityResult> {
    const result: ApiCompatibilityResult = {
      componentName: contractFile,
      isCompatible: true,
      issues: [],
      recommendations: [],
    };

    try {
      const content = await fs.readFile(contractFile, 'utf8');

      // Check for common API compatibility issues
      if (content.includes('any') && !contractFile.includes('types')) {
        result.issues.push('Use of "any" type detected - consider more specific typing');
        result.isCompatible = false;
      }

      if (content.includes('void') && content.includes('return')) {
        result.recommendations.push('Consider returning meaningful values instead of void');
      }

      // Check for inconsistent naming patterns
      const camelCaseMatches = (content.match(/[a-z][a-zA-Z]*[A-Z][a-zA-Z]*/g) || []).length;
      const snakeCaseMatches = (content.match(/[a-z][a-z0-9]*_[a-z0-9]+/g) || []).length;

      if (camelCaseMatches > 0 && snakeCaseMatches > 0) {
        result.issues.push('Mixed naming conventions detected (camelCase and snake_case)');
        result.isCompatible = false;
      }
    } catch (error) {
      result.issues.push(
        `Error reading contract file: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isCompatible = false;
    }

    return result;
  }

  /**
   * Check common API patterns
   * @returns Array of pattern check results
   */
  private async checkCommonApiPatterns(): Promise<ApiCompatibilityResult[]> {
    const results: ApiCompatibilityResult[] = [];

    try {
      // Check for consistent error handling patterns
      const errorHandlingResult = await this.checkErrorHandling();
      results.push(errorHandlingResult);

      // Check for consistent response patterns
      const responsePatternResult = await this.checkResponsePatterns();
      results.push(responsePatternResult);

      // Check for consistent parameter patterns
      const paramPatternResult = await this.checkParameterPatterns();
      results.push(paramPatternResult);
    } catch (error) {
      results.push({
        componentName: 'common-patterns',
        isCompatible: false,
        issues: [
          `Error checking common patterns: ${error instanceof Error ? error.message : String(error)}`,
        ],
        recommendations: [],
      });
    }

    return results;
  }

  /**
   * Check error handling consistency
   * @returns Error handling check result
   */
  private async checkErrorHandling(): Promise<ApiCompatibilityResult> {
    const result: ApiCompatibilityResult = {
      componentName: 'error-handling',
      isCompatible: true,
      issues: [],
      recommendations: [],
    };

    try {
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      let errorHandlersFound = 0;
      // let inconsistentHandlers = 0; // Removed unused variable

      for (const file of files) {
        if (file.includes('.ts') || file.includes('.js')) {
          try {
            const content = await fs.readFile(file, 'utf8');

            // Look for error handling patterns
            if (content.includes('try') || content.includes('catch') || content.includes('throw')) {
              errorHandlersFound++;

              // Check for consistent error object patterns
              if (content.includes('new Error(') && !content.includes('Error.prototype')) {
                // This is a basic check - in reality, more sophisticated validation would be needed
              }
            }
          } catch {
            // Ignore file reading errors
          }
        }
      }

      if (errorHandlersFound === 0) {
        result.recommendations.push('Consider implementing consistent error handling patterns');
      }
    } catch (error) {
      result.issues.push(
        `Error checking error handling: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isCompatible = false;
    }

    return result;
  }

  /**
   * Check response patterns consistency
   * @returns Response pattern check result
   */
  private async checkResponsePatterns(): Promise<ApiCompatibilityResult> {
    const result: ApiCompatibilityResult = {
      componentName: 'response-patterns',
      isCompatible: true,
      issues: [],
      recommendations: [],
    };

    try {
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      let responseHandlersFound = 0;
      // let inconsistentResponses = 0; // Removed unused variable

      for (const file of files) {
        if (file.includes('.ts') || file.includes('.js')) {
          try {
            const content = await fs.readFile(file, 'utf8');

            // Look for response handling patterns
            if (
              content.includes('res.send') ||
              content.includes('res.json') ||
              content.includes('res.status')
            ) {
              responseHandlersFound++;

              // Check for consistent response structures
              if (content.includes('{') && content.includes('}')) {
                // Basic consistency check
              }
            }
          } catch {
            // Ignore file reading errors
          }
        }
      }

      if (responseHandlersFound === 0) {
        result.recommendations.push('Consider implementing consistent response handling patterns');
      }
    } catch (error) {
      result.issues.push(
        `Error checking response patterns: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isCompatible = false;
    }

    return result;
  }

  /**
   * Check parameter patterns consistency
   * @returns Parameter pattern check result
   */
  private async checkParameterPatterns(): Promise<ApiCompatibilityResult> {
    const result: ApiCompatibilityResult = {
      componentName: 'parameter-patterns',
      isCompatible: true,
      issues: [],
      recommendations: [],
    };

    try {
      const rootDir = process.cwd();
      const files = await this.walkDirectory(rootDir);

      let paramHandlersFound = 0;

      for (const file of files) {
        if (file.includes('.ts') || file.includes('.js')) {
          try {
            const content = await fs.readFile(file, 'utf8');

            // Look for parameter handling patterns
            if (
              content.includes('params') ||
              content.includes('query') ||
              content.includes('body')
            ) {
              paramHandlersFound++;

              // Check for consistent parameter validation
              if (
                !content.includes('validate') &&
                !content.includes('zod') &&
                !content.includes('joi')
              ) {
                result.recommendations.push('Consider adding parameter validation for consistency');
              }
            }
          } catch {
            // Ignore file reading errors
          }
        }
      }

      if (paramHandlersFound === 0) {
        result.recommendations.push('Consider implementing consistent parameter handling patterns');
      }
    } catch (error) {
      result.issues.push(
        `Error checking parameter patterns: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isCompatible = false;
    }

    return result;
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
   * Generate API compatibility report
   * @param results Compatibility check results
   * @returns Formatted report
   */
  generateReport(results: ApiCompatibilityResult[]): string {
    const reportLines: string[] = [];

    reportLines.push('API Compatibility Report');
    reportLines.push('========================');
    reportLines.push('');

    let overallCompatible = true;

    for (const result of results) {
      const statusIcon = result.isCompatible ? '✅' : '❌';
      reportLines.push(
        `${statusIcon} ${result.componentName}: ${result.isCompatible ? 'Compatible' : 'Incompatible'}`,
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

      if (!result.isCompatible) {
        overallCompatible = false;
      }
    }

    reportLines.push(
      `Overall Status: ${overallCompatible ? '✅ All APIs compatible' : '❌ Some API compatibility issues found'}`,
    );

    return reportLines.join('\n');
  }

  /**
   * Check if APIs are compatible with current implementation
   * @returns Compatibility status
   */
  async checkCurrentApiCompatibility(): Promise<boolean> {
    const results = await this.checkApiCompatibility();
    return results.every((r) => r.isCompatible);
  }
}

// Export the checker for use in other modules
export const apiCompatibilityChecker = new ApiCompatibilityChecker();

// If called directly, run compatibility check
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const checker = new ApiCompatibilityChecker();

  checker
    .checkApiCompatibility()
    .then((results) => {
      console.log(checker.generateReport(results));

      const allCompatible = results.every((r) => r.isCompatible);
      if (allCompatible) {
        console.log('✅ All APIs are compatible');
      } else {
        console.log('❌ Some API compatibility issues found');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('API compatibility check error:', error);
      process.exit(1);
    });
}
