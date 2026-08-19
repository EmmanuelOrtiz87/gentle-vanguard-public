/**
 * Gentle-Vanguard CMS Unified Export System
 *
 * Exporta todos los assets generados por las herramientas a un solo ZIP
 * Incluye: imágenes, videos (como frames), posts, contratos, y metadata
 *
 * @author Gentle-Vanguard Team
 * @version 1.0.0
 */

class CMSExporter {
  constructor() {
    this.VERSION = '1.0.0';
    this.DB_KEY = 'gentleVanguardCMS';
  }

  /**
   * Exporta todo el proyecto a un ZIP descargable
   */
  async exportAllToZIP(projectName = 'gentle-vanguard-project') {
    console.log('📦 Iniciando exportación unificada...');

    const startTime = performance.now();
    const zip = new JSZip();

    // 1. Crear estructura de carpetas
    zip.folder('images');
    zip.folder('videos');
    zip.folder('posts');
    zip.folder('contracts');
    zip.folder('assets');

    // 2. Exportar imágenes del Image Studio
    await this.exportImages(zip);

    // 3. Exportar videos del Video Studio
    await this.exportVideos(zip);

    // 4. Exportar posts del Social Post
    await this.exportPosts(zip);

    // 5. Exportar contratos del Contract Viewer
    await this.exportContracts(zip);

    // 6. Exportar metadata del proyecto
    await this.exportMetadata(zip, projectName);

    // 7. Generar README con instrucciones
    await this.generateREADME(zip);

    // 8. Generar y descargar el ZIP
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Descargar
    this.downloadFile(content, `${projectName}-v${this.VERSION}.zip`);

    console.log(`✅ Exportación completada en ${duration}s`);
    return {
      success: true,
      duration,
      size: (content.size / 1024 / 1024).toFixed(2) + ' MB',
    };
  }

  /**
   * Exporta imágenes del Image Studio
   */
  async exportImages(zip) {
    const imagesFolder = zip.folder('images');

    // Obtener del localStorage del Image Studio
    const imageData = localStorage.getItem('imageStudioHistory');
    if (imageData) {
      try {
        const images = JSON.parse(imageData);
        let count = 0;

        for (let i = 0; i < images.length && i < 50; i++) {
          // Limitar a 50 imágenes
          const img = images[i];
          if (img.dataUrl) {
            const base64 = img.dataUrl.split(',')[1];
            const format = img.format || 'png';
            const filename = `image_${String(i + 1).padStart(3, '0')}.${format}`;

            imagesFolder.file(filename, base64, { base64: true });
            count++;
          }
        }

        console.log(`✅ Exportadas ${count} imágenes`);
      } catch (e) {
        console.warn('⚠️ Error exportando imágenes:', e);
      }
    }

    // Crear índice
    imagesFolder.file(
      'images-index.json',
      JSON.stringify(
        {
          source: 'Gentle-Vanguard Image Studio',
          exported: new Date().toISOString(),
          format: 'PNG/JPG/WebP',
          total: 'Ver metadata del proyecto',
        },
        null,
        2,
      ),
    );
  }

  /**
   * Exporta videos como frames secuenciales
   */
  async exportVideos(zip) {
    const videosFolder = zip.folder('videos');

    const videoData = localStorage.getItem('videoStudioProjects');
    if (videoData) {
      try {
        const videos = JSON.parse(videoData);

        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          const projectFolder = videosFolder.folder(`video_${String(i + 1).padStart(3, '0')}`);

          // Exportar metadata
          projectFolder.file(
            'metadata.json',
            JSON.stringify(
              {
                name: video.name || `Video ${i + 1}`,
                duration: video.duration,
                fps: video.fps,
                frames: video.frameCount,
                generator: video.generator,
                animation: video.animation,
                exported: new Date().toISOString(),
              },
              null,
              2,
            ),
          );

          // Exportar frames
          const framesFolder = projectFolder.folder('frames');
          if (video.frames && video.frames.length) {
            for (let j = 0; j < Math.min(video.frames.length, 100); j++) {
              const frame = video.frames[j];
              if (frame.dataUrl) {
                const base64 = frame.dataUrl.split(',')[1];
                const filename = `frame_${String(j + 1).padStart(4, '0')}.png`;
                framesFolder.file(filename, base64, { base64: true });
              }
            }
          }
        }

        console.log(`✅ Exportados ${videos.length} proyectos de video`);
      } catch (e) {
        console.warn('⚠️ Error exportando videos:', e);
      }
    }

    // Archivo de instrucciones
    videosFolder.file(
      'HOW_TO_COMPILE.md',
      `# Compilación de Videos

## Opción 1: FFmpeg (Recomendado)
\`\`\`bash
# MP4 desde frames
ffmpeg -framerate 30 -i video_%03d/frame_%04d.png -c:v libx264 -preset slow -crf 22 output.mp4

# GIF animado
ffmpeg -framerate 30 -i video_%03d/frame_%04d.png -vf "scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" output.gif
\`\`\`

## Opción 2: Adobe Premiere / After Effects
Importar secuencia de imágenes como video.

## Opción 3: Online
Usar convertidores como ezgif.com o cloudconvert.com
`,
    );
  }

  /**
   * Exporta posts del Social Post Generator
   */
  async exportPosts(zip) {
    const postsFolder = zip.folder('posts');

    // Obtener posts guardados
    const posts = localStorage.getItem('socialPosts');
    if (posts) {
      try {
        const postsData = JSON.parse(posts);

        // Exportar cada post
        const exports = {
          json: [],
          csv: 'Platform,Template,Content,Hashtags,Date\n',
          markdown: [],
        };

        postsData.forEach((post, i) => {
          // JSON
          exports.json.push(post);

          // CSV
          const hashtags = (post.content.match(/#[\w\u00e0-\u00ff]+/g) || []).join(' ');
          const contentClean =
            post.content.replace(/"/g, '""').substring(0, 200) +
            (post.content.length > 200 ? '...' : '');
          exports.csv += `"${post.platform}","${post.template}","${contentClean}","${hashtags}","${post.date}"\n`;

          // Markdown individual
          const mdContent = `---
platform: ${post.platform}
template: ${post.template}
date: ${post.date}
---

${post.content}
`;
          postsFolder.file(`post_${String(i + 1).padStart(3, '0')}.md`, mdContent);
        });

        // Archivos agregados
        postsFolder.file('posts-all.json', JSON.stringify(exports.json, null, 2));
        postsFolder.file('posts-all.csv', exports.csv);
        postsFolder.file('posts-all.md', exports.markdown.join('\n---\n\n'));

        // Índice
        postsFolder.file(
          'index.json',
          JSON.stringify(
            {
              total: postsData.length,
              exported: new Date().toISOString(),
              platforms: [...new Set(postsData.map((p) => p.platform))],
              templates: [...new Set(postsData.map((p) => p.template))],
            },
            null,
            2,
          ),
        );

        console.log(`✅ Exportados ${postsData.length} posts`);
      } catch (e) {
        console.warn('⚠️ Error exportando posts:', e);
      }
    }
  }

  /**
   * Exporta contratos del Contract Viewer
   */
  async exportContracts(zip) {
    const contractsFolder = zip.folder('contracts');

    // Contratos embebidos
    const embeddedFolder = contractsFolder.folder('embedded');
    embeddedFolder.file('consulting-services-agreement.md', this.getConsultingTemplate());

    // Contratos personalizados
    const customContracts = localStorage.getItem('customContracts');
    if (customContracts) {
      try {
        const contracts = JSON.parse(customContracts);
        const customFolder = contractsFolder.folder('custom');

        contracts.forEach((contract) => {
          customFolder.file(`contract-${contract.id}.md`, contract.content);
          customFolder.file(`contract-${contract.id}.json`, JSON.stringify(contract, null, 2));
        });

        console.log(`✅ Exportados ${contracts.length} contratos personalizados`);
      } catch (e) {
        console.warn('⚠️ Error exportando contratos:', e);
      }
    }

    // Backup general
    contractsFolder.file('backup-all.json', customContracts || '[]');
  }

  /**
   * Exporta metadata del proyecto
   */
  async exportMetadata(zip, projectName) {
    const stats = this.calculateStats();

    const metadata = {
      name: projectName,
      version: this.VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: navigator.userAgent,
      size: this.calculateSize(),
      stats: stats,
      files: {
        images: stats.images,
        videos: stats.videos,
        posts: stats.posts,
        contracts: stats.contracts,
      },
    };

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));
    console.log('✅ Metadata exportada');
  }

  /**
   * Genera README con instrucciones
   */
  async generateREADME(zip) {
    const readme = `# ${this.DB_KEY} - Proyecto Exportado

## 📦 Contenido

Este archivo ZIP contiene todos los assets generados con el ecossistema Gentle-Vanguard CMS:

- **images/** - Imágenes generadas con Image Studio
- **videos/** - Videos generados (frames en PNG)
- **posts/** - Posts para redes sociales
- **contracts/** - Contratos y documentos legales
- **metadata.json** - Información del proyecto

## 🚀 Uso Rápido

### Imágenes
Las imágenes están en formato PNG/JPG/WebP. Usar directamente en diseño.

### Videos
Ver instrucciones en: \`videos/HOW_TO_COMPILE.md\`

### Posts
- \`posts/posts-all.csv\` - Importar a Excel/Google Sheets
- \`posts/posts-all.json\` - Importar a sistemas CMS
- \`posts/*.md\` - Cada post individual

### Contratos
- \`contracts/embedded/\` - Templates estándar
- \`contracts/custom/\` - Contratos personalizados

## 📊 Estadísticas

Ver \`metadata.json\` para estadísticas detalladas del proyecto.

## 🔄 Re-importación

Para re-importar este proyecto al CMS:
1. Extraer el ZIP
2. Ir a Configuración → Importar
3. Seleccionar \`metadata.json\`

## 📅 Exportado

- Fecha: ${new Date().toLocaleString()}
- Versión CMS: ${this.VERSION}

---
*Generado con Gentle-Vanguard CMS - 100% Offline*
`;

    zip.file('README.md', readme);
    zip.file(
      'INSTRUCCIONES.md',
      readme.replace('Fast Use', 'Uso Rápido').replace('Quick Start', 'Inicio Rápido'),
    );
  }

  /**
   * Calcula estadísticas del proyecto
   */
  calculateStats() {
    const stats = {
      images: 0,
      videos: 0,
      posts: 0,
      contracts: 0,
    };

    // Contar imágenes
    const imgData = localStorage.getItem('imageStudioHistory');
    if (imgData) {
      try {
        stats.images = JSON.parse(imgData).length;
      } catch (e) {}
    }

    // Contar videos
    const vidData = localStorage.getItem('videoStudioProjects');
    if (vidData) {
      try {
        stats.videos = JSON.parse(vidData).length;
      } catch (e) {}
    }

    // Contar posts
    const postData = localStorage.getItem('socialPosts');
    if (postData) {
      try {
        stats.posts = JSON.parse(postData).length;
      } catch (e) {}
    }

    // Contar contratos
    const contractData = localStorage.getItem('customContracts');
    if (contractData) {
      try {
        stats.contracts = JSON.parse(contractData).length;
      } catch (e) {}
    }

    return stats;
  }

  /**
   * Calcula tamaño estimado
   */
  calculateSize() {
    let size = 0;

    // localStorage total
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        size += localStorage[key].length * 2; // UTF-16
      }
    }

    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(2) + ' KB';
    return (size / 1024 / 1024).toFixed(2) + ' MB';
  }

  /**
   * Template para exportar contrato de consultoría
   */
  getConsultingTemplate() {
    return `# CONTRATO DE SERVICIOS PROFESIONALES

Ver archivo completo: docs/contracts/consulting-services-agreement.md

Este es un template exportado automáticamente por Gentle-Vanguard CMS.
`;
  }

  /**
   * Descarga un archivo
   */
  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`📥 Descargado: ${filename}`);
  }
}

// Inicializar globalmente para uso en el CMS
window.CMSExporter = CMSExporter;

// Exportar para módulos (si se usa module system)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CMSExporter;
}

console.log('✅ CMS Export System cargado');
console.log('   Uso: const exporter = new CMSExporter();');
console.log('   exporter.exportAllToZIP("mi-proyecto");');
