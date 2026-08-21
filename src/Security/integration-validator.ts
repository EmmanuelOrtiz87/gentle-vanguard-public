#!/usr/bin/env node

/**
 * Integration Point Validator
 * Validates integration points for new skills and agents
 */

import { promises as fs } from 'fs';
import { join } from 'path';

/**
 * Integration point validation result
 */
interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Integration point validator class
 */
export class IntegrationValidator {
  /**
   * Validate a skill integration point
   * @param skillPath Path to the skill directory
   * @returns Validation result
   */
  async validateSkillIntegration(skillPath: string): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      suggestions: [],
    };

    try {
      // Check if skill directory exists
      const stat = await fs.stat(skillPath);
      if (!stat.isDirectory()) {
        result.isValid = false;
        result.errors.push(`Skill path is not a directory: ${skillPath}`);
        return result;
      }

      // Check for required files
      const requiredFiles = ['SKILL.md', 'package.json'];
      for (const file of requiredFiles) {
        try {
          await fs.access(join(skillPath, file));
        } catch {
          result.errors.push(`Required file missing: ${file}`);
          result.isValid = false;
        }
      }

      // Validate skill metadata
      const packageJsonPath = join(skillPath, 'package.json');
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageJsonContent);

        if (!packageJson.name) {
          result.errors.push('Skill package.json missing name field');
          result.isValid = false;
        }

        if (!packageJson.version) {
          result.errors.push('Skill package.json missing version field');
          result.isValid = false;
        }

        if (!packageJson.description) {
          result.warnings.push('Skill package.json missing description field');
        }
      } catch {
        result.errors.push('Invalid package.json format');
        result.isValid = false;
      }

      // Check for security considerations
      const skillMdPath = join(skillPath, 'SKILL.md');
      try {
        const skillMdContent = await fs.readFile(skillMdPath, 'utf8');

        // Look for security mentions
        if (!skillMdContent.toLowerCase().includes('security')) {
          result.suggestions.push('Consider adding security considerations to SKILL.md');
        }

        // Look for integration points
        if (!skillMdContent.toLowerCase().includes('integration')) {
          result.suggestions.push('Consider documenting integration points in SKILL.md');
        }
      } catch {
        result.warnings.push('SKILL.md not found for validation');
      }

      // Validate compatibility with current system
      const compatibilityCheck = await this.checkCompatibility(skillPath);
      if (!compatibilityCheck.isValid) {
        result.isValid = false;
        result.errors.push(...compatibilityCheck.errors);
      }
    } catch (error) {
      result.isValid = false;
      result.errors.push(
        `Error validating skill: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return result;
  }

  /**
   * Check compatibility with current system
   * @param skillPath Path to skill directory
   * @returns Compatibility check result
   */
  private async checkCompatibility(
    skillPath: string,
  ): Promise<{ isValid: boolean; errors: string[]; suggestions: string[] }> {
    const result: { isValid: boolean; errors: string[]; suggestions: string[] } = {
      isValid: true,
      errors: [],
      suggestions: [],
    };

    // Check for conflicting dependencies
    try {
      const packageJsonPath = join(skillPath, 'package.json');
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent);

      // Check for peer dependencies that might conflict
      if (packageJson.peerDependencies) {
        const peerDeps = Object.keys(packageJson.peerDependencies);
        if (peerDeps.length > 0) {
          result.suggestions.push(
            `Peer dependencies detected: ${peerDeps.join(', ')}. Verify compatibility.`,
          );
        }
      }

      // Check for direct dependencies that might cause conflicts
      if (packageJson.dependencies) {
        const deps = Object.keys(packageJson.dependencies);
        if (deps.length > 0) {
          result.suggestions.push(
            `Dependencies detected: ${deps.join(', ')}. Verify compatibility.`,
          );
        }
      }
    } catch (error) {
      result.errors.push(
        `Error checking compatibility: ${error instanceof Error ? error.message : String(error)}`,
      );
      result.isValid = false;
    }

    return result;
  }

  /**
   * Validate multiple integration points
   * @param skillPaths Array of skill paths to validate
   * @returns Array of validation results
   */
  async validateMultipleSkills(
    skillPaths: string[],
  ): Promise<Array<{ path: string; result: ValidationResult }>> {
    const results: Array<{ path: string; result: ValidationResult }> = [];

    for (const skillPath of skillPaths) {
      const result = await this.validateSkillIntegration(skillPath);
      results.push({ path: skillPath, result });
    }

    return results;
  }

  /**
   * Generate validation report
   * @param results Validation results
   * @returns Formatted report
   */
  generateReport(results: Array<{ path: string; result: ValidationResult }>): string {
    const reportLines: string[] = [];

    reportLines.push('Integration Point Validation Report');
    reportLines.push('====================================');
    reportLines.push('');

    for (const { path, result } of results) {
      reportLines.push(`Path: ${path}`);
      reportLines.push(`Status: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);

      if (result.errors.length > 0) {
        reportLines.push('Errors:');
        for (const error of result.errors) {
          reportLines.push(`  - ${error}`);
        }
      }

      if (result.warnings.length > 0) {
        reportLines.push('Warnings:');
        for (const warning of result.warnings) {
          reportLines.push(`  - ${warning}`);
        }
      }

      if (result.suggestions.length > 0) {
        reportLines.push('Suggestions:');
        for (const suggestion of result.suggestions) {
          reportLines.push(`  - ${suggestion}`);
        }
      }

      reportLines.push('');
    }

    return reportLines.join('\n');
  }
}

// Export the validator for use in other modules
export const integrationValidator = new IntegrationValidator();

// If called directly, run validation
if (process.argv[1] && typeof process !== 'undefined' && process.argv[1]) {
  const validator = new IntegrationValidator();

  // Example usage
  const skillPaths = ['./skills/example-skill', './skills/another-skill'];

  validator
    .validateMultipleSkills(skillPaths)
    .then((results) => {
      console.log(validator.generateReport(results));

      const allValid = results.every((r) => r.result.isValid);
      if (allValid) {
        console.log('✅ All integration points validated successfully');
      } else {
        console.log('❌ Some integration points have validation errors');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('Validation error:', error);
      process.exit(1);
    });
}
