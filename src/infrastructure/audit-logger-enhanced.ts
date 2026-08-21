#!/usr/bin/env node

/**
 * Enhanced audit logging system
 * Improves audit trail logging with better session correlation
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';

// Enhanced audit log entry structure
export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  userId?: string;
  action: string;
  component: string;
  status: 'success' | 'failure' | 'warning';
  details?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

// Enhanced audit logger with better session correlation
export class EnhancedAuditLogger {
  private logFilePath: string;

  constructor(logFilePath: string = './.session/audit.log') {
    this.logFilePath = logFilePath;
  }

  /**
   * Log an audit entry with enhanced correlation
   * @param entry The audit entry to log
   */
  async log(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
    const auditEntry: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    // Generate correlation ID if not provided
    if (!auditEntry.correlationId) {
      auditEntry.correlationId = this.generateCorrelationId(
        auditEntry.sessionId,
        auditEntry.action,
        auditEntry.component,
      );
    }

    try {
      const logLine = JSON.stringify(auditEntry) + '\n';
      await fs.appendFile(this.logFilePath, logLine, { encoding: 'utf8' });
      console.log(`Audit logged: ${auditEntry.action} in ${auditEntry.component}`);
    } catch (error) {
      console.error('Failed to write audit log:', error);
      throw error;
    }
  }

  /**
   * Generate a correlation ID for better audit trail linking
   * @param sessionId The session ID
   * @param action The action performed
   * @param component The component involved
   * @returns A unique correlation ID
   */
  private generateCorrelationId(sessionId: string, action: string, component: string): string {
    const input = `${sessionId}-${action}-${component}-${Date.now()}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 16);
  }

  /**
   * Search audit logs by session ID
   * @param sessionId The session ID to search for
   * @returns Array of audit entries for that session
   */
  async searchBySession(sessionId: string): Promise<AuditEntry[]> {
    try {
      const logContent = await fs.readFile(this.logFilePath, 'utf8');
      const lines = logContent.split('\n').filter((line) => line.trim() !== '');

      return lines
        .map((line) => {
          try {
            return JSON.parse(line) as AuditEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is AuditEntry => entry !== null && entry.sessionId === sessionId);
    } catch (error) {
      console.error('Failed to search audit logs:', error);
      return [];
    }
  }
}

// Export the logger for use in other modules
export const auditLogger = new EnhancedAuditLogger();

// If called directly, demonstrate usage
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const logger = new EnhancedAuditLogger();

  // Example usage
  logger
    .log({
      sessionId: 'sess-12345',
      userId: 'user-abcde',
      action: 'security_check',
      component: 'security-orchestrator',
      status: 'success',
      details: 'Prompt injection patterns verified',
    })
    .catch(console.error);
}
