import os from 'node:os';

const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

function formatBytes(bytes) {
  if (bytes > GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes > MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes > KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

function getUptime() {
  const sec = Math.floor(os.uptime());
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

export const definition = {
  name: 'system_info',
  description: 'Returns OS info: hostname, platform, memory, CPU, uptime, load. Useful for diagnostics.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export async function execute(args, log) {
  try {
    const info = {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      memory: {
        total: formatBytes(os.totalmem()),
        free: formatBytes(os.freemem()),
        usage: `${((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)}%`,
      },
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim() || 'unknown',
      uptime: getUptime(),
      loadavg: os.loadavg().map(v => v.toFixed(2)).join(', '),
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
    };
    const lines = [
      `Host: ${info.hostname} (${info.platform})`,
      `CPU: ${info.cpus}x ${info.cpuModel}`,
      `Memory: ${info.memory.free} free / ${info.memory.total} (${info.memory.usage})`,
      `Uptime: ${info.uptime}`,
      `Load: ${info.loadavg}`,
    ];
    return { success: true, output: lines.join('\n'), data: info };
  } catch (err) {
    return { success: false, output: `system_info error: ${err.message}` };
  }
}
