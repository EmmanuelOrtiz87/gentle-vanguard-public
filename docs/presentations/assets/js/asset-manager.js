/**
 * Gentle-Vanguard Cross-Tool Asset Manager
 *
 * Sistema de gestión de assets que permite:
 * - Compartir imágenes entre Image Studio y otros tools
 * - Usar frames de video como imágenes
 * - Importar assets a proyectos
 * - Biblioteca centralizada de recursos
 *
 * @author Gentle-Vanguard Team
 * @version 1.0.0
 */

class AssetManager {
  constructor() {
    this.DB_KEY = 'gentleVanguardAssets';
    this.DB_VERSION = 1;
    this.store = null;
    this.init();
  }

  async init() {
    // Abrir o crear IndexedDB
    const request = indexedDB.open(this.DB_KEY, this.DB_VERSION);

    request.onerror = (event) => {
      console.error('❌ Error abriendo IndexedDB:', event.target.error);
    };

    request.onsuccess = (event) => {
      this.store = event.target.result;
      console.log('✅ Asset Manager Inicializado');
      console.log('   IndexedDB versión:', this.DB_VERSION);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Almacén de assets
      if (!db.objectStoreNames.contains('assets')) {
        const store = db.createObjectStore('assets', { keyPath: 'id', autoIncrement: true });
        store.createIndex('byType', 'type', { unique: false });
        store.createIndex('byTool', 'sourceTool', { unique: false });
        store.createIndex('byDate', 'createdAt', { unique: false });
        store.createIndex('byTags', 'tags', { unique: false, multiEntry: true });
      }

      // Almacén de proyectos
      if (!db.objectStoreNames.contains('projects')) {
        const projStore = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        projStore.createIndex('byName', 'name', { unique: false });
        projStore.createIndex('byDate', 'createdAt', { unique: false });
      }
    };
  }

  /**
   * Guarda un asset en la biblioteca
   */
  async saveAsset({
    name,
    type, // 'image', 'video', 'post', 'contract'
    sourceTool, // 'imageStudio', 'videoStudio', 'socialPost', etc.
    dataUrl,
    metadata = {},
    tags = [],
    projectId = null,
  }) {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readwrite');
      const assetStore = transaction.objectStore('assets');

      const asset = {
        name: name || `${type}_${Date.now()}`,
        type,
        sourceTool,
        dataUrl,
        metadata,
        tags: Array.isArray(tags) ? tags : [tags],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        projectId,
        size: this.estimateSize(dataUrl),
      };

      const request = assetStore.add(asset);

      request.onsuccess = () => {
        console.log('✅ Asset guardado:', asset.name);
        resolve({
          id: request.result,
          ...asset,
        });
      };

      request.onerror = () => {
        console.error('❌ Error guardando asset:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Recupera un asset por ID
   */
  async getAsset(id) {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Obtiene assets por tipo
   */
  async getAssetsByType(type, limit = 50) {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const index = store.index('byType');
      const request = index.getAll(type, limit);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Obtiene assets por tool de origen
   */
  async getAssetsByTool(tool, limit = 50) {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const index = store.index('byTool');
      const request = index.getAll(tool, limit);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca assets por término
   */
  async searchAssets(query, limit = 20) {
    return new Promise(async (resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      try {
        // Obtener todos y filtrar (para búsquedas simples)
        const transaction = this.store.transaction(['assets'], 'readonly');
        const store = transaction.objectStore('assets');
        const request = store.getAll();

        request.onsuccess = () => {
          const allAssets = request.result;
          const queryLower = query.toLowerCase();

          const filtered = allAssets
            .filter((asset) => {
              const nameMatch = asset.name && asset.name.toLowerCase().includes(queryLower);
              const tagMatch =
                asset.tags && asset.tags.some((t) => t.toLowerCase().includes(queryLower));
              const typeMatch = asset.type && asset.type.toLowerCase().includes(queryLower);

              return nameMatch || tagMatch || typeMatch;
            })
            .slice(0, limit);

          resolve(filtered);
        };

        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Elimina un asset
   */
  async deleteAsset(id) {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log('✅ Asset eliminado:', id);
        resolve(true);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Actualiza un asset
   */
  async updateAsset(id, updates) {
    return new Promise(async (resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const asset = await this.getAsset(id);
      if (!asset) {
        reject(new Error('Asset no encontrado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');

      const updated = {
        ...asset,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      const request = store.put(updated);

      request.onsuccess = () => resolve(updated);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Importa assets desde localStorage (migración de tools individuales)
   */
  async migrateFromLocalStorage() {
    console.log('🔄 Migrando assets desde localStorage...');
    const migrated = [];

    // Imágenes del Image Studio
    const imgData = localStorage.getItem('imageStudioHistory');
    if (imgData) {
      try {
        const images = JSON.parse(imgData);
        for (const img of images) {
          if (img.dataUrl) {
            const asset = await this.saveAsset({
              name: `image_migrated_${img.timestamp || Date.now()}`,
              type: 'image',
              sourceTool: 'imageStudio',
              dataUrl: img.dataUrl,
              metadata: {
                original: img,
                migrated: true,
                timestamp: img.timestamp,
              },
              tags: ['migrated', 'imageStudio'],
            });
            migrated.push(asset);
          }
        }
        console.log(`   ${migrated.length} imágenes migradas`);
      } catch (e) {
        console.warn('⚠️ Error migrando imágenes:', e);
      }
    }

    // Videos del Video Studio
    const vidData = localStorage.getItem('videoStudioProjects');
    if (vidData) {
      try {
        const videos = JSON.parse(vidData);
        for (const vid of videos) {
          if (vid.frames && vid.frames.length > 0) {
            const asset = await this.saveAsset({
              name: `video_${vid.name || 'migrated'}`,
              type: 'video',
              sourceTool: 'videoStudio',
              dataUrl: vid.frames[0].dataUrl, // Preview
              metadata: {
                frames: vid.frames.length,
                migrated: true,
                config: vid.config,
              },
              tags: ['migrated', 'videoStudio', 'video'],
            });
            migrated.push(asset);
          }
        }
        console.log(`   ${migrated.length} videos migrados`);
      } catch (e) {
        console.warn('⚠️ Error migrando videos:', e);
      }
    }

    console.log(`✅ Migración completada: ${migrated.length} assets`);
    return migrated;
  }

  /**
   * Obtiene estadísticas de uso
   */
  async getStats() {
    return new Promise((resolve, reject) => {
      if (!this.store) {
        reject(new Error('Asset Manager no inicializado'));
        return;
      }

      const transaction = this.store.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const request = store.getAll();

      request.onsuccess = () => {
        const assets = request.result;
        const stats = {
          total: assets.length,
          byType: {},
          byTool: {},
          totalSize: 0,
          oldest: null,
          newest: null,
        };

        assets.forEach((asset) => {
          // Por tipo
          stats.byType[asset.type] = (stats.byType[asset.type] || 0) + 1;

          // Por tool
          stats.byTool[asset.sourceTool] = (stats.byTool[asset.sourceTool] || 0) + 1;

          // Tamaño
          if (asset.size) stats.totalSize += asset.size;

          // Fechas
          const date = new Date(asset.createdAt);
          if (!stats.oldest || date < stats.oldest) stats.oldest = date;
          if (!stats.newest || date > stats.newest) stats.newest = date;
        });

        stats.totalSize = this.formatSize(stats.totalSize);
        stats.oldest = stats.oldest?.toISOString();
        stats.newest = stats.newest?.toISOString();

        resolve(stats);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Limpia assets antiguos
   */
  async cleanup(olderThanDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const assets = await this.getAssetsByType('all');
    const toDelete = assets.filter((a) => new Date(a.createdAt) < cutoff);

    for (const asset of toDelete) {
      await this.deleteAsset(asset.id);
    }

    console.log(`🧹 Limpieza completada: ${toDelete.length} assets eliminados`);
    return toDelete.length;
  }

  // Helper: estima tamaño de dataUrl
  estimateSize(dataUrl) {
    if (!dataUrl) return 0;
    const base64 = dataUrl.split(',')[1] || '';
    return Math.round((base64.length * 3) / 4);
  }

  // Helper: formatea tamaño
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }
}

// Plugin para integrar con Image Studio
AssetManager.prototype.imageStudioExport = async function (imageData) {
  return this.saveAsset({
    name: `image_${imageData.name || Date.now()}`,
    type: 'image',
    sourceTool: 'imageStudio',
    dataUrl: imageData.dataUrl,
    metadata: {
      generator: imageData.generator,
      template: imageData.template,
      dimensiones: `${imageData.width}x${imageData.height}`,
      complexity: imageData.complexity,
    },
    tags: ['image', imageData.generator, imageData.template],
  });
};

// Plugin para integrar con Video Studio
AssetManager.prototype.videoStudioExport = async function (videoData) {
  return this.saveAsset({
    name: videoData.name || `video_${Date.now()}`,
    type: 'video',
    sourceTool: 'videoStudio',
    dataUrl: videoData.thumbnail, // Frame de preview
    metadata: {
      frames: videoData.frameCount,
      duration: videoData.duration,
      fps: videoData.fps,
      generator: videoData.generator,
      animation: videoData.animation,
      framesData: videoData.frames, // Guardar todos los frames
    },
    tags: ['video', videoData.generator, videoData.animation],
  });
};

// Inicializar global
window.AssetManager = AssetManager;

console.log('✅ Asset Manager cargado');
console.log('   Uso: const am = new AssetManager();');
