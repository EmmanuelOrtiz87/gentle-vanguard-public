#!/usr/bin/env node
/**
 * marketing-agent.ts
 * Agente nativo de Gentle-Vanguard para generación de contenido de marketing
 * Multi-idioma, multi-plataforma, brand-compliant
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

// Types
interface Platform {
  name: string;
  maxLength: number;
  maxHashtags: number;
  emojiSupport: boolean;
  threadSupport: boolean;
}

interface ContentRequest {
  topic: string;
  platform: string;
  lang: 'es' | 'en' | 'pt';
  tone: 'professional' | 'casual' | 'enthusiastic';
  includeHashtags: boolean;
  includeEmoji: boolean;
}

interface GeneratedContent {
  platform: string;
  lang: string;
  content: string;
  hashtags: string[];
  images?: string[];
  thread?: string[];
}

// Platform configs
const PLATFORMS: Record<string, Platform> = {
  linkedin: {
    name: 'LinkedIn',
    maxLength: 3000,
    maxHashtags: 5,
    emojiSupport: true,
    threadSupport: true,
  },
  twitter: {
    name: 'Twitter/X',
    maxLength: 280,
    maxHashtags: 3,
    emojiSupport: true,
    threadSupport: true,
  },
  instagram: {
    name: 'Instagram',
    maxLength: 2200,
    maxHashtags: 30,
    emojiSupport: true,
    threadSupport: false,
  },
  github: {
    name: 'GitHub',
    maxLength: 5000,
    maxHashtags: 5,
    emojiSupport: true,
    threadSupport: false,
  },
};

// Multi-language templates
const TEMPLATES: Record<string, Record<string, string>> = {
  launch: {
    es: `🚀 ¡Presentamos {product}!

{description}

✨ Lo que incluye:
{features}

💡 Perfecto para: {target}

🔗 {cta}

{hashtags}`,
    en: `🚀 Introducing {product}!

{description}

✨ What's included:
{features}

💡 Perfect for: {target}

🔗 {cta}

{hashtags}`,
    pt: `🚀 Apresentamos {product}!

{description}

✨ O que inclui:
{features}

💡 Perfeito para: {target}

🔗 {cta}

{hashtags}`,
  },
  feature: {
    es: `💡 {feature}

{benefit}

✨ Características:
{details}

🔗 {cta}

{hashtags}`,
    en: `💡 {feature}

{benefit}

✨ Features:
{details}

🔗 {cta}

{hashtags}`,
    pt: `💡 {feature}

{benefit}

✨ Características:
{details}

🔗 {cta}

{hashtags}`,
  },
  tip: {
    es: `💡 Tip del día: {tip}

{explanation}

✨ Beneficios:
{benefits}

🔗 {cta}

{hashtags}`,
    en: `💡 Tip of the day: {tip}

{explanation}

✨ Benefits:
{benefits}

🔗 {cta}

{hashtags}`,
    pt: `💡 Dica do dia: {tip}

{explanation}

✨ Benefícios:
{benefits}

🔗 {cta}

{hashtags}`,
  },
  case_study: {
    es: `📊 Caso de estudio: {title}

El desafío:
{challenge}

La solución:
{solution}

Resultados:
{results}

{hashtags}`,
    en: `📊 Case study: {title}

The challenge:
{challenge}

The solution:
{solution}

Results:
{results}

{hashtags}`,
    pt: `📊 Estudo de caso: {title}

O desafio:
{challenge}

A solução:
{solution}

Resultados:
{results}

{hashtags}`,
  },
};

// Hashtag sets by language
const HASHTAGS: Record<string, Record<string, string[]>> = {
  es: {
    ai: ['#IA', '#InteligenciaArtificial', '#Automatización', '#Desarrollo', '#Tecnología'],
    dev: ['#DevTools', '#Desarrollador', '#Código', '#Programación', '#Software'],
    product: ['#Producto', '#Startup', '#Emprendimiento', '#Innovación', '#Negocio'],
    marketing: ['#Marketing', '#SocialMedia', '#Contenido', '#Digital', '#Crecimiento'],
  },
  en: {
    ai: ['#AI', '#ArtificialIntelligence', '#Automation', '#Development', '#Technology'],
    dev: ['#DevTools', '#Developer', '#Coding', '#Programming', '#Software'],
    product: ['#Product', '#Startup', '#Entrepreneurship', '#Innovation', '#Business'],
    marketing: ['#Marketing', '#SocialMedia', '#Content', '#Digital', '#Growth'],
  },
  pt: {
    ai: ['#IA', '#InteligênciaArtificial', '#Automação', '#Desenvolvimento', '#Tecnologia'],
    dev: ['#DevTools', '#Desenvolvedor', '#Código', '#Programação', '#Software'],
    product: ['#Produto', '#Startup', '#Empreendedorismo', '#Inovação', '#Negócio'],
    marketing: ['#Marketing', '#SocialMedia', '#Conteúdo', '#Digital', '#Crescimento'],
  },
};

// Branded hashtags
const BRANDED: Record<string, string[]> = {
  es: ['#GentleVanguard', '#Autonomía', '#StackNativo', '#FuturoDelCódigo'],
  en: ['#GentleVanguard', '#Autonomous', '#NativeStack', '#FutureOfCoding'],
  pt: ['#GentleVanguard', '#Autonomia', '#StackNativo', '#FuturoDoCódigo'],
};

class MarketingAgent {
  private outputDir: string;

  constructor(outputDir: string = '.session/marketing-content') {
    this.outputDir = outputDir;
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate content for a specific platform and language
   */
  public generateContent(request: ContentRequest): GeneratedContent {
    const platform = PLATFORMS[request.platform];
    if (!platform) {
      throw new Error(`Unknown platform: ${request.platform}`);
    }

    const template = this.getTemplate('feature', request.lang);
    const vars = this.extractVariables(request);
    const content = this.fillTemplate(template, vars);
    const hashtags = this.generateHashtags(request.lang, request.topic);

    return {
      platform: platform.name,
      lang: request.lang,
      content: this.optimizeContent(content, platform, request),
      hashtags,
    };
  }

  /**
   * Generate multi-language content for all platforms
   */
  public generateMultiLang(
    topic: string,
    _templateName: string,
  ): Record<string, GeneratedContent[]> {
    const results: Record<string, GeneratedContent[]> = {};
    const languages: ('es' | 'en' | 'pt')[] = ['es', 'en', 'pt'];
    const platforms = Object.keys(PLATFORMS);

    for (const lang of languages) {
      results[lang] = [];
      for (const platform of platforms) {
        const request: ContentRequest = {
          topic,
          platform,
          lang,
          tone: 'professional',
          includeHashtags: true,
          includeEmoji: true,
        };
        results[lang].push(this.generateContent(request));
      }
    }

    return results;
  }

  /**
   * Save generated content to file
   */
  public saveContent(content: GeneratedContent, filename?: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeFilename = filename || `${content.platform}-${content.lang}-${timestamp}`;
    const filepath = join(this.outputDir, `${safeFilename}.md`);

    const markdown = this.toMarkdown(content);
    writeFileSync(filepath, markdown, 'utf-8');

    console.log(`💾 Content saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Generate images for social media
   */
  public async generateImages(
    content: string,
    platform: string,
    count: number = 1,
  ): Promise<string[]> {
    const images: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < count; i++) {
      const filename = `${platform}-image-${timestamp}-${i + 1}.svg`;
      const filepath = join(this.outputDir, filename);

      // Generate placeholder SVG with content
      const svg = this.generatePlaceholderSVG(content, platform);
      writeFileSync(filepath, svg, 'utf-8');

      images.push(filepath);
      console.log(`🖼️ Image generated: ${filepath}`);
    }

    return images;
  }

  private getTemplate(templateName: string, lang: string): string {
    const templates = TEMPLATES[templateName];
    if (!templates) {
      throw new Error(`Unknown template: ${templateName}`);
    }
    return templates[lang] || templates['en'];
  }

  private extractVariables(request: ContentRequest): Record<string, string> {
    const variables: Record<string, string> = {
      product: 'Gentle-Vanguard',
      description: 'Stack nativo autónomo de IA',
      features: '✓ 21 agentes\n✓ 294 archivos TS\n✓ 103 tests',
      target: 'desarrolladores, startups, enterprise',
      cta: 'gentle-vanguard.io',
      feature: request.topic,
      benefit: 'Aumenta tu productividad 10x',
      details: 'Implementación nativa, zero dependencies',
      tip: 'Usa TypeScript para type safety',
      explanation: 'Compila-time verification previene errores',
      benefits: 'Menos bugs, mejor DX, escala mejor',
      challenge: 'Código legacy difícil de mantener',
      solution: 'Migración gradual a TS con el stack nativo',
      results: '70% menos bugs, 3x más rápido',
      title: 'Migración exitosa',
    };

    return variables;
  }

  private fillTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`{${key}}`, 'g'), value);
    }
    return result;
  }

  private generateHashtags(lang: string, topic: string): string[] {
    const hashtags: string[] = [];
    const available = HASHTAGS[lang] || HASHTAGS['en'];
    const branded = BRANDED[lang] || BRANDED['en'];

    // Add branded hashtags (always)
    hashtags.push(...branded.slice(0, 2));

    // Add topic hashtags
    const topicKey = this.categorizeTopic(topic);
    if (available[topicKey]) {
      hashtags.push(...available[topicKey].slice(0, 3));
    } else {
      hashtags.push(...available.dev.slice(0, 3));
    }

    return hashtags;
  }

  private categorizeTopic(topic: string): string {
    const lower = topic.toLowerCase();
    if (lower.includes('ai') || lower.includes('inteligencia') || lower.includes('agent'))
      return 'ai';
    if (lower.includes('dev') || lower.includes('código') || lower.includes('code')) return 'dev';
    if (lower.includes('product') || lower.includes('startup')) return 'product';
    if (lower.includes('market') || lower.includes('social')) return 'marketing';
    return 'dev';
  }

  private optimizeContent(content: string, platform: Platform, request: ContentRequest): string {
    let optimized = content;

    // Add hashtags if requested
    if (request.includeHashtags && !content.includes('#')) {
      optimized = this.addHashtagsToContent(content, request.lang);
    }

    // Add emoji if requested and platform supports it
    if (request.includeEmoji && platform.emojiSupport) {
      optimized = this.addEmojiTone(optimized, request.tone);
    }

    return optimized;
  }

  private addHashtagsToContent(content: string, lang: string): string {
    const hashtags = this.generateHashtags(lang, content);
    return `${content}\n\n${hashtags.join(' ')}`;
  }

  private addEmojiTone(content: string, tone: string): string {
    const emojis: Record<string, string[]> = {
      professional: ['✅', '📊', '💡'],
      casual: ['🚀', '✨', '🔥'],
      enthusiastic: ['🎉', '🚀', '🌟'],
    };

    const toneEmojis = emojis[tone] || emojis.professional;
    // Don't add if already has emoji
    if (/\p{Extended_Pictographic}/u.test(content)) return content;

    return `${toneEmojis[0]} ${content}`;
  }

  private toMarkdown(content: GeneratedContent): string {
    return `---
platform: ${content.platform}
lang: ${content.lang}
generated: ${new Date().toISOString()}
---

# ${content.platform} - ${content.lang.toUpperCase()}

${content.content}

---

**Hashtags:** ${content.hashtags.join(', ')}
`;
  }

  private generatePlaceholderSVG(content: string, platform: string): string {
    const color =
      platform === 'linkedin'
        ? '#0a66c2'
        : platform === 'twitter'
          ? '#1da1f2'
          : platform === 'instagram'
            ? '#e4405f'
            : '#22d3ee';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0a0e1a"/>
          <stop offset="100%" style="stop-color:#1a1f2e"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <text x="600" y="300" text-anchor="middle" fill="${color}" font-family="Inter" font-size="64" font-weight="bold">
        Gentle-Vanguard
      </text>
      <text x="600" y="380" text-anchor="middle" fill="#e2e8f0" font-family="Inter" font-size="32">
        ${platform.toUpperCase()}
      </text>
      <text x="600" y="440" text-anchor="middle" fill="#64748b" font-family="Inter" font-size="24">
        ${content.substring(0, 50)}...
      </text>
    </svg>`;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Gentle-Vanguard Marketing Agent

Usage:
  npx tsx src/marketing-agent.ts [options]

Options:
  --topic=<topic>       Topic to generate content about
  --platform=<platform> Platform (linkedin, twitter, instagram, github)
  --lang=<lang>         Language (es, en, pt)
  --tone=<tone>         Tone (professional, casual, enthusiastic)
  --template=<name>     Template name (launch, feature, tip, case_study)
  --multi-lang          Generate for all languages
  --images=<n>          Generate n images
  --output=<dir>        Output directory
  --help               Show this help

Examples:
  npx tsx src/marketing-agent.ts --topic="Migration TS" --platform=linkedin --lang=es
  npx tsx src/marketing-agent.ts --template=launch --topic="v4.0" --multi-lang
`);
    return;
  }

  const agent = new MarketingAgent();

  // Parse args
  const topic = args.find((a) => a.startsWith('--topic='))?.split('=')[1] || 'Features';
  const platform = args.find((a) => a.startsWith('--platform='))?.split('=')[1] || 'linkedin';
  const lang =
    (args.find((a) => a.startsWith('--lang='))?.split('=')[1] as 'es' | 'en' | 'pt') || 'es';
  const tone =
    (args.find((a) => a.startsWith('--tone='))?.split('=')[1] as
      'professional' | 'casual' | 'enthusiastic') || 'professional';
  const template = args.find((a) => a.startsWith('--template='))?.split('=')[1] || 'feature';
  const multiLang = args.includes('--multi-lang');
  const imageCount = parseInt(args.find((a) => a.startsWith('--images='))?.split('=')[1] || '0');

  console.log('🤖 Gentle-Vanguard Marketing Agent');
  console.log('====================================');
  console.log(`Topic: ${topic}`);
  console.log(`Platform: ${platform}`);
  console.log(`Language: ${lang}`);
  console.log('');

  if (multiLang) {
    console.log('🌍 Generating multi-language content...');
    const content = agent.generateMultiLang(topic, template);

    for (const [langKey, posts] of Object.entries(content)) {
      console.log(`\n📄 ${langKey.toUpperCase()}:`);
      for (const post of posts) {
        console.log(`  - ${post.platform}: ${post.content.substring(0, 100)}...`);
        agent.saveContent(post, `${topic}-${langKey}-${post.platform}`);
      }
    }
  } else {
    const request: ContentRequest = {
      topic,
      platform,
      lang,
      tone,
      includeHashtags: true,
      includeEmoji: true,
    };

    const content = agent.generateContent(request);
    console.log('📝 Generated content:');
    console.log(content.content);
    console.log('\n🏷️ Hashtags:', content.hashtags.join(', '));

    agent.saveContent(content);

    if (imageCount > 0) {
      console.log(`\n🖼️ Generating ${imageCount} images...`);
      await agent.generateImages(content.content, platform, imageCount);
    }
  }

  console.log('\n✅ Done!');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { MarketingAgent, PLATFORMS, TEMPLATES, HASHTAGS };
export type { ContentRequest, GeneratedContent, Platform };
