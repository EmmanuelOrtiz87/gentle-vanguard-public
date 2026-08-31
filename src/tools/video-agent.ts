#!/usr/bin/env node
/**
 * video-agent.ts
 * Gentle-Vanguard Video Generator Agent
 * Crea videos demostrativos, tutoriales y simulaciones nativamente
 *
 * @module video-agent
 * @version 1.0.0
 */

import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

// Types
interface VideoConfig {
  type: 'demo' | 'tutorial' | 'simulation' | 'architecture';
  topic: string;
  duration: number; // seconds
  resolution: '720p' | '1080p' | '4K';
  fps: number;
  voiceOver?: boolean;
  captions?: boolean;
  bgMusic?: boolean;
  lang: 'es' | 'en' | 'pt';
}

interface DemoStep {
  id: string;
  title: string;
  description: string;
  action: string;
  highlight?: string[];
  duration: number; // seconds
}

interface VideoAgent {
  createDemo(config: VideoConfig, steps: DemoStep[]): Promise<string>;
  recordScreen(url: string, duration: number): Promise<string>;
  generateFromScript(script: VideoScript): Promise<string>;
  createArchitectureVisual(flow: ArchitectureFlow): Promise<string>;
}

interface VideoScript {
  scenes: Scene[];
  voiceOver?: string[];
  bgMusic?: string;
}

interface Scene {
  id: number;
  duration: number;
  type: 'screen' | 'terminal' | 'diagram' | 'text';
  content: string;
  transitions?: string;
}

interface ArchitectureFlow {
  steps: FlowStep[];
  connections: Connection[];
}

interface FlowStep {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

interface Connection {
  from: string;
  to: string;
  label?: string;
}

class GentleVideoAgent implements VideoAgent {
  private outputDir: string;
  private tempDir: string;
  private ffmpegAvailable: boolean;

  constructor(outputDir: string = '.session/videos') {
    this.outputDir = outputDir;
    this.tempDir = join(outputDir, 'temp');
    this.ffmpegAvailable = this.checkFFmpeg();
    this.ensureDirectories();
  }

  private checkFFmpeg(): boolean {
    try {
      // Check if ffmpeg is available
      spawn('ffmpeg', ['-version'], { stdio: 'pipe', windowsHide: true });
      return true;
    } catch {
      console.log('⚠️ FFmpeg no disponible. Videos se generarán como frames secuenciales.');
      return false;
    }
  }

  private ensureDirectories(): void {
    [this.outputDir, this.tempDir].forEach((dir) => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Create simulated demo video
   */
  async createDemo(config: VideoConfig, steps: DemoStep[]): Promise<string> {
    console.log(`🎬 Generando demo: ${config.topic}`);
    console.log(`   Duración: ${config.duration}s | Resolución: ${config.resolution}`);

    const timestamp = Date.now();
    const videoName = `demo-${config.topic.toLowerCase().replace(/\s+/g, '-')}-${timestamp}`;
    const outputPath = join(this.outputDir, `${videoName}.mp4`);

    // Generate frames
    const framesDir = join(this.tempDir, videoName);
    mkdirSync(framesDir, { recursive: true });

    let frameIndex = 0;
    for (const step of steps) {
      const frameCount = Math.ceil(step.duration * config.fps);
      for (let i = 0; i < frameCount; i++) {
        const html = this.generateDemoFrame(step, config, i, frameCount);
        const framePath = join(framesDir, `frame-${String(frameIndex).padStart(6, '0')}.html`);
        writeFileSync(framePath, html, 'utf-8');
        frameIndex++;
      }
    }

    // Compile video if ffmpeg available
    if (this.ffmpegAvailable) {
      await this.compileVideo(framesDir, outputPath, config.fps);
    } else {
      // Fallback: return frames directory for manual compilation
      console.log(`✅ Frames generados en: ${framesDir}`);
      console.log(`   Para compilar video, instala FFmpeg y ejecuta:`);
      console.log(
        `   ffmpeg -framerate ${config.fps} -i ${framesDir}/frame-%06d.html -c:v libx264 ${outputPath}`,
      );
      return framesDir;
    }

    console.log(`✅ Video generado: ${outputPath}`);
    return outputPath;
  }

  /**
   * Record actual screen (requires puppeteer/playwright)
   */
  async recordScreen(url: string, duration: number): Promise<string> {
    console.log(`📹 Grabando pantalla: ${url} (${duration}s)`);

    // Note: Requires puppeteer or playwright to be installed
    // This is a placeholder implementation

    console.log('⚠️ Record de pantalla requiere Puppeteer/Playwright');
    console.log('   Instala con: npm install puppeteer');
    console.log('   O usa la versión simulada: createDemo()');

    throw new Error('Screen recording requires puppeteer. Use createDemo() for simulated videos.');
  }

  /**
   * Generate video from script
   */
  async generateFromScript(_script: VideoScript): Promise<string> {
    console.log('📝 Generando video desde script...');

    // Implementation would process script scenes
    // and generate corresponding frames/video

    throw new Error('Not implemented yet');
  }

  /**
   * Create architecture visualization video
   */
  async createArchitectureVisual(flow: ArchitectureFlow): Promise<string> {
    console.log('🏗️ Generando visualización de arquitectura...');

    const timestamp = Date.now();
    const videoName = `architecture-${timestamp}`;
    const outputPath = join(this.outputDir, `${videoName}.svg`);

    const svg = this.generateArchitectureSVG(flow);
    writeFileSync(outputPath, svg, 'utf-8');

    console.log(`✅ Diagrama generado: ${outputPath}`);
    return outputPath;
  }

  /**
   * Generate demo frame HTML
   */
  private generateDemoFrame(
    step: DemoStep,
    config: VideoConfig,
    frameIndex: number,
    totalFrames: number,
  ): string {
    const progress = ((frameIndex / totalFrames) * 100).toFixed(1);

    return `<!DOCTYPE html>
<html lang="${config.lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${step.title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px;
      height: 1080px;
      background: #0a0e1a;
      font-family: 'JetBrains Mono', 'Consolas', monospace;
      color: #e2e8f0;
      display: flex;
      flex-direction: column;
      padding: 60px;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 20px;
      margin-bottom: 40px;
    }
    .logo {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, #22d3ee, #a78bfa);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    .title-area h1 {
      font-size: 32px;
      background: linear-gradient(135deg, #22d3ee, #67e8f9);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    .title-area p {
      color: #94a3b8;
      font-size: 16px;
    }
    .container {
      flex: 1;
      background: #141824;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 40px;
      position: relative;
    }
    .step-indicator {
      position: absolute;
      top: -15px;
      left: 40px;
      background: linear-gradient(135deg, #22d3ee, #a78bfa);
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      color: #0a0e1a;
    }
    .content {
      margin-top: 20px;
    }
    .action-box {
      background: #1e293b;
      border-left: 4px solid #22d3ee;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      font-size: 18px;
    }
    .action-label {
      color: #22d3ee;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .progress-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      height: 6px;
      background: linear-gradient(90deg, #22d3ee, #a78bfa);
      width: ${progress}%;
    }
    .footer {
      position: fixed;
      bottom: 20px;
      right: 40px;
      color: #64748b;
      font-size: 14px;
    }
    ${
      step.highlight
        ?.map(
          (h) => `
    .highlight-${h} {
      animation: pulse 1s ease-in-out infinite;
      border: 2px solid #22d3ee;
      border-radius: 4px;
    }
    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 0 0 #22d3ee40; }
      50% { box-shadow: 0 0 20px 10px #22d3ee40; }
    }
    `,
        )
        .join('') || ''
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">⚡</div>
    <div class="title-area">
      <h1>${step.title}</h1>
      <p>${step.description}</p>
    </div>
  </div>
  
  <div class="container">
    <div class="step-indicator">Paso ${step.id}</div>
    <div class="content">
      <div class="action-box">
        <div class="action-label">Acción</div>
        <code>${step.action}</code>
      </div>
    </div>
  </div>
  
  <div class="progress-bar"></div>
  <div class="footer">Gentle-Vanguard Demo | ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
  }

  /**
   * Generate architecture SVG
   */
  private generateArchitectureSVG(flow: ArchitectureFlow): string {
    const width = 1200;
    const height = 800;

    // Generate nodes
    const nodeElements = flow.steps
      .map(
        (step) => `
      <g transform="translate(${step.x}, ${step.y})">
        <rect x="-60" y="-30" width="120" height="60" 
              fill="#141824" stroke="${step.color}" stroke-width="2" rx="8" />
        <text x="0" y="5" text-anchor="middle" fill="#e2e8f0" font-size="14">${step.label}</text>
      </g>
    `,
      )
      .join('');

    // Generate connections
    const connectionElements = flow.connections
      .map((conn) => {
        const from = flow.steps.find((s) => s.id === conn.from);
        const to = flow.steps.find((s) => s.id === conn.to);
        if (!from || !to) return '';

        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        return `
        <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" 
              stroke="#22d3ee" stroke-width="2" marker-end="url(#arrow)" />
        ${conn.label ? `<text x="${midX}" y="${midY - 10}" text-anchor="middle" fill="#94a3b8" font-size="12">${conn.label}</text>` : ''}
      `;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#22d3ee" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#0a0e1a"/>
  
  <!-- Title -->
  <text x="50%" y="40" text-anchor="middle" fill="#22d3ee" font-size="24" font-weight="bold">
    Arquitectura Gentle-Vanguard
  </text>
  
  <!-- Connections -->
  ${connectionElements}
  
  <!-- Nodes -->
  ${nodeElements}
</svg>`;
  }

  /**
   * Compile frames to video using ffmpeg
   */
  private async compileVideo(framesDir: string, outputPath: string, fps: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(
        'ffmpeg',
        [
          '-framerate',
          String(fps),
          '-pattern_type',
          'glob',
          '-i',
          `${framesDir}/*.html`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-y',
          outputPath,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          // Cleanup temp frames
          rmSync(framesDir, { recursive: true, force: true });
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });
  }

  /**
   * Clean temp directories
   */
  cleanup(): void {
    if (existsSync(this.tempDir)) {
      rmSync(this.tempDir, { recursive: true, force: true });
      console.log('🧹 Limpieza completada');
    }
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Gentle-Vanguard Video Agent

Usage:
  npx tsx src/tools/video-agent.ts [command] [options]

Commands:
  demo [topic] [duration]     Create simulated demo
  architecture [file]        Create architecture visualization
  record [url] [duration]     Record screen (requires puppeteer)
  cleanup                     Clean temp directories

Examples:
  npx tsx src/tools/video-agent.ts demo "Migration" 60
  npx tsx src/tools/video-agent.ts architecture src/arch-flow.json
  npx tsx src/tools/video-agent.ts record https://localhost:5173 30
`);
    return;
  }

  const agent = new GentleVideoAgent();

  const command = args[0];

  switch (command) {
    case 'demo': {
      const topic = args[1] || 'features';
      const duration = parseInt(args[2] || '10');

      const steps: DemoStep[] = [
        {
          id: '1',
          title: 'Inicio de Sesión',
          description: 'Comenzamos una sesión de trabajo',
          action: 'npx tsx src/session/session-autostart.ts',
          duration: 2,
        },
        {
          id: '2',
          title: 'Ejecución de Agentes',
          description: '21 agentes se activan automáticamente',
          action: '21 agents ready ✓',
          duration: 3,
        },
        {
          id: '3',
          title: 'Pipeline Activo',
          description: 'El stack opera de forma autónoma',
          action: '100% autonomous operation',
          duration: 3,
        },
        {
          id: '4',
          title: 'Resultado',
          description: 'Tarea completada exitosamente',
          action: '✓ Task completed',
          duration: 2,
        },
      ];

      const config: VideoConfig = {
        type: 'demo',
        topic,
        duration,
        resolution: '1080p',
        fps: 30,
        lang: 'es',
      };

      const output = await agent.createDemo(config, steps);
      console.log(`\n✅ Video generado: ${output}`);
      break;
    }

    case 'architecture': {
      const flow: ArchitectureFlow = {
        steps: [
          { id: 'user', label: 'Usuario', x: 100, y: 400, color: '#22d3ee' },
          { id: 'orchestrator', label: 'Orchestrator', x: 400, y: 400, color: '#a78bfa' },
          { id: 'ba', label: 'BA Agent', x: 700, y: 200, color: '#34d399' },
          { id: 'dev', label: 'DEV Agent', x: 700, y: 400, color: '#34d399' },
          { id: 'qa', label: 'QA Agent', x: 700, y: 600, color: '#34d399' },
          { id: 'output', label: 'Output', x: 1000, y: 400, color: '#22d3ee' },
        ],
        connections: [
          { from: 'user', to: 'orchestrator', label: 'Request' },
          { from: 'orchestrator', to: 'ba', label: 'Explore' },
          { from: 'orchestrator', to: 'dev', label: 'Build' },
          { from: 'orchestrator', to: 'qa', label: 'Verify' },
          { from: 'ba', to: 'output' },
          { from: 'dev', to: 'output' },
          { from: 'qa', to: 'output' },
        ],
      };

      const output = await agent.createArchitectureVisual(flow);
      console.log(`\n✅ Diagrama generado: ${output}`);
      break;
    }

    case 'cleanup':
      agent.cleanup();
      break;

    default:
      console.log('Comando no reconocido. Usa --help para ver opciones.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { GentleVideoAgent };
export type { VideoConfig, DemoStep, VideoScript, ArchitectureFlow };
