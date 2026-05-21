import { toolDefinitions as gatewayToolDefs, executeTool as gatewayExec } from '../gateway/agent/tools.js';

const rpcToolDefs = [
  {
    name: 'rpc_health',
    description: 'Returns RPC server health status including uptime, request count, and available tools.',
    parameters: {
      type: 'object',
      properties: {
        requestCount: { type: 'number', description: 'Current request count from server' },
        uptime: { type: 'number', description: 'Server uptime in seconds' },
      },
    },
  },
  {
    name: 'rpc_batch',
    description: 'Execute multiple tools in sequence or parallel. Returns array of results in task order.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['sequential', 'parallel'], description: 'Execution mode' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name to execute' },
              args: { type: 'object', description: 'Arguments for the tool' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'rpc_chain',
    description: 'Chain tools where the output of one feeds into the next. Use extract to pluck fields from previous results.',
    parameters: {
      type: 'object',
      properties: {
        chain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: 'Tool name to execute' },
              args: { type: 'object', description: 'Base arguments for the tool' },
              extract: { type: 'string', description: 'Field to extract from previous result ($ = full result, .field = field value, omit to inject as "input")' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['chain'],
    },
  },
  {
    name: 'rpc_watch',
    description: 'Poll a tool at a given interval until a condition is met or max polls reached.',
    parameters: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool name to poll' },
        args: { type: 'object', description: 'Arguments for the tool' },
        intervalMs: { type: 'number', description: 'Polling interval in milliseconds (default: 5000)' },
        maxPolls: { type: 'number', description: 'Maximum number of polls (default: 6)' },
        condition: { type: 'string', description: 'Stop condition, e.g. "success == true" or "output contains done"' },
      },
      required: ['tool'],
    },
  },
];

export const toolDefinitions = [...gatewayToolDefs, ...rpcToolDefs];
export const availableTools = toolDefinitions.map(t => t.name);

function resolveExtract(prevResult, extract) {
  if (!extract) return { input: prevResult.output ?? JSON.stringify(prevResult) };
  if (extract === '$') return prevResult;
  const key = extract.startsWith('.') ? extract.slice(1) : extract;
  return { [key]: prevResult[key] };
}

function evalCondition(result, condition) {
  const m = condition.match(/^(\w+)\s*(==|!=|>|<|>=|<=|contains)\s*(.+)$/);
  if (!m) return false;
  const [, field, op, rawExpected] = m;
  const val = String(result[field] ?? '');
  const exp = rawExpected.trim().replace(/^['"]|['"]$/g, '');
  switch (op) {
    case '==': return val === exp;
    case '!=': return val !== exp;
    case 'contains': return val.includes(exp);
    case '>': return Number(val) > Number(exp);
    case '<': return Number(val) < Number(exp);
    case '>=': return Number(val) >= Number(exp);
    case '<=': return Number(val) <= Number(exp);
    default: return false;
  }
}

export async function executeTool(toolName, args, log) {
  switch (toolName) {
    case 'rpc_health': {
      return {
        success: true,
        output: JSON.stringify({
          status: 'ok',
          uptime: args.uptime ?? 0,
          requestCount: args.requestCount ?? 0,
          tools: availableTools,
          timestamp: new Date().toISOString(),
        }),
        uptime: args.uptime ?? 0,
        requestCount: args.requestCount ?? 0,
        toolCount: availableTools.length,
      };
    }
    case 'rpc_batch': {
      const { mode = 'sequential', tasks = [] } = args;
      const execute = t => executeTool(t.tool, t.args ?? {}, log);
      const results = mode === 'parallel' ? await Promise.all(tasks.map(execute)) : [];
      if (mode !== 'parallel') {
        for (const task of tasks) {
          results.push(await executeTool(task.tool, task.args ?? {}, log));
        }
      }
      return { success: true, output: JSON.stringify(results), results };
    }
    case 'rpc_chain': {
      const { chain = [] } = args;
      const results = [];
      for (let i = 0; i < chain.length; i++) {
        const step = chain[i];
        let stepArgs = { ...(step.args ?? {}) };
        if (i > 0) {
          const merged = resolveExtract(results[i - 1], step.extract);
          stepArgs = { ...stepArgs, ...merged };
        }
        const result = await executeTool(step.tool, stepArgs, log);
        results.push(result);
      }
      return { success: true, output: JSON.stringify(results), results };
    }
    case 'rpc_watch': {
      const { tool, args: toolArgs = {}, intervalMs = 5000, maxPolls = 6, condition = null } = args;
      const pollResults = [];
      for (let i = 0; i < maxPolls; i++) {
        const result = await executeTool(tool, toolArgs, log);
        pollResults.push({ poll: i + 1, result });
        if (condition && evalCondition(result, condition)) break;
        if (i < maxPolls - 1) await new Promise(r => setTimeout(r, intervalMs));
      }
      return { success: true, output: JSON.stringify(pollResults), pollResults };
    }
    default:
      return gatewayExec(toolName, args, log);
  }
}
