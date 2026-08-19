/**
 * Gentle-Vanguard CMS - Content Operations Engine Integration
 *
 * Conecta el CMS de Marketing con el Content Operations Engine (COE).
 * Lee el manifest embebido (window.COE_MANIFEST, generado desde
 * content/operations/master-manifest.json) y permite operar los jobs:
 * - Vista kanban/tabla de los 21 jobs del calendario
 * - Filtros por plataforma / estado / campaña
 * - Transiciones de estado (DRAFT → VALIDATED → PACKAGED → REVIEW → APPROVED → PUBLISHED → MEASURED)
 * - Persistencia local (localStorage) para que los cambios sobrevivan en file://
 * - Export del manifest actualizado (JSON) para volver al engine
 *
 * @author Gentle-Vanguard Team
 * @version 1.0.0
 */

class COECMS {
  constructor() {
    this.VERSION = '1.0.0';
    this.DB_KEY = 'gentleVanguardCOE';
    this.MANIFEST_KEY = 'gentleVanguardCOEManifest';
    this.STATES = [
      'DRAFT',
      'VALIDATED',
      'PACKAGED',
      'REVIEW',
      'APPROVED',
      'PUBLISHED',
      'MEASURED',
      'FAILED',
    ];
    // Transiciones válidas por estado (mismo orden que el engine)
    this.TRANSITIONS = {
      DRAFT: ['VALIDATED', 'FAILED'],
      VALIDATED: ['PACKAGED', 'FAILED'],
      PACKAGED: ['REVIEW', 'FAILED'],
      REVIEW: ['APPROVED', 'FAILED'],
      APPROVED: ['PUBLISHED', 'FAILED'],
      PUBLISHED: ['MEASURED'],
      MEASURED: ['DRAFT'],
      FAILED: ['DRAFT'],
    };
    this.PLATFORM_ICONS = {
      linkedin: 'bi-linkedin',
      x: 'bi-twitter-x',
      instagram: 'bi-instagram',
      youtube: 'bi-youtube',
      tiktok: 'bi-music-note-beamed',
      whatsapp_channel: 'bi-whatsapp',
      whatsapp_status: 'bi-whatsapp',
      github: 'bi-github',
      devto: 'bi-code-slash',
      producthunt: 'bi-rocket-takeoff',
      discord: 'bi-discord',
    };
    this.STATE_COLORS = {
      DRAFT: '#94a3b8',
      VALIDATED: '#38bdf8',
      PACKAGED: '#a78bfa',
      REVIEW: '#fbbf24',
      APPROVED: '#34d399',
      PUBLISHED: '#22c55e',
      MEASURED: '#64748b',
      FAILED: '#ef4444',
    };
    this.jobs = [];
    this.filters = { platform: 'all', status: 'all', campaign: 'all' };
  }

  /* ====================== Carga de datos ====================== */

  /**
   * Carga el manifest: primero localStorage (estado persistido por el usuario),
   * luego el embebido (window.COE_MANIFEST). Merge: los overrides de estado
   * del usuario se aplican sobre el manifest base.
   */
  load() {
    const base = Array.isArray(window.COE_MANIFEST) ? window.COE_MANIFEST : [];
    const overrides = this._readOverrides();
    this.jobs = base.map((job) => {
      const ov = overrides[job.id];
      return ov ? { ...job, ...ov } : { ...job };
    });
    return this.jobs;
  }

  _readOverrides() {
    try {
      return JSON.parse(localStorage.getItem(this.DB_KEY) || '{}');
    } catch {
      return {};
    }
  }

  _writeOverrides() {
    const overrides = {};
    this.jobs.forEach((job) => {
      overrides[job.id] = {
        status: job.status,
        title: job.title,
        date: job.date,
        platform: job.platform,
        theme: job.theme,
        copy: job.copy,
        cta: job.cta,
      };
    });
    localStorage.setItem(this.DB_KEY, JSON.stringify(overrides));
  }

  /**
   * Exporta el manifest actualizado (con estados del usuario) como JSON
   * descargable — listo para re-importar en el engine (content:import).
   */
  exportManifest() {
    const manifest = this.jobs.map((job) => ({
      id: job.id,
      date: job.date,
      timezone: job.timezone,
      platform: job.platform,
      campaign: job.campaign,
      theme: job.theme,
      contentType: job.contentType,
      title: job.title,
      copy: job.copy,
      cta: job.cta,
      asset: job.asset,
      status: job.status,
      approvalRequired: job.approvalRequired,
      variants: job.variants,
    }));
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'master-manifest.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ====================== Transiciones ====================== */

  transition(jobId, nextState) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    const allowed = this.TRANSITIONS[job.status] || [];
    if (!allowed.includes(nextState)) return false;
    job.status = nextState;
    this._writeOverrides();
    this.render();
    return true;
  }

  /**
   * Reinicia un job a DRAFT desde cualquier estado (incluido MEASURED/PUBLISHED).
   * Permite volver a editar contenido que ya pasó por todo el flujo.
   */
  reset(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    job.status = 'DRAFT';
    this._writeOverrides();
    this.render();
    return true;
  }

  /**
   * Abre el editor inline de un job. Permite modificar title, copy, cta, theme,
   * date y platform incluso en estados finales. Los cambios se persisten en
   * localStorage y se exportan con el manifest.
   */
  edit(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const color = this.STATE_COLORS[job.status] || '#94a3b8';
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999;
      display: flex; align-items: center; justify-content: center; padding: 1rem;
    `;
    modal.innerHTML = `
      <div style="background: var(--bg1); border: 1px solid var(--bg2); border-radius: 16px;
        max-width: 680px; width: 100%; max-height: 88vh; overflow-y: auto; padding: 1.5rem">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h5 style="margin: 0; color: var(--text)"><i class="bi bi-pencil-square me-2" style="color: var(--p)"></i>Editar Job</h5>
            <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem">
              ${job.id} · <span class="badge" style="background: ${color}22; color: ${color}; border: 1px solid ${color}55">${job.status}</span>
            </div>
          </div>
          <button class="btn btn-sm" style="background: var(--bg2); color: var(--text); border: none"
            onclick="this.closest('div[style]').remove()">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div class="mb-3">
          <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">Título</label>
          <input id="coe-edit-title" class="form-control form-control-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2)"
            value="${this._escAttr(job.title)}" />
        </div>
        <div class="row mb-3">
          <div class="col-md-6">
            <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">Fecha</label>
            <input id="coe-edit-date" type="date" class="form-control form-control-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2)"
              value="${this._escAttr(job.date)}" />
          </div>
          <div class="col-md-6">
            <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">Plataforma</label>
            <select id="coe-edit-platform" class="form-select form-select-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2)">
              ${Object.keys(this.PLATFORM_ICONS)
                .map(
                  (p) =>
                    `<option value="${p}" ${job.platform === p ? 'selected' : ''}>${p}</option>`,
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">Tema</label>
          <input id="coe-edit-theme" class="form-control form-control-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2)"
            value="${this._escAttr(job.theme)}" />
        </div>
        <div class="mb-3">
          <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">Copy</label>
          <textarea id="coe-edit-copy" rows="8" class="form-control form-control-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem">${this._escTextarea(job.copy)}</textarea>
        </div>
        <div class="mb-3">
          <label style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem; display: block">CTA</label>
          <input id="coe-edit-cta" class="form-control form-control-sm" style="background: var(--bg0); color: var(--text); border: 1px solid var(--bg2)"
            value="${this._escAttr(job.cta)}" />
        </div>
        <div class="d-flex flex-wrap gap-2 mt-4">
          <button class="btn btn-sm" style="background: linear-gradient(135deg, var(--p), var(--s)); color: var(--bg0); border: none; font-weight: 600"
            onclick="window.coeCMS.saveEdit('${job.id}')">
            <i class="bi bi-check-lg me-1"></i>Guardar Cambios
          </button>
          <button class="btn btn-sm" style="background: var(--bg2); color: var(--text-dim); border: none"
            onclick="this.closest('div[style]').remove()">
            <i class="bi bi-x-lg me-1"></i>Cancelar
          </button>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  /**
   * Guarda los cambios del editor inline en el job y persiste en localStorage.
   */
  saveEdit(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const get = (id) => document.getElementById(id);
    const title = get('coe-edit-title');
    const date = get('coe-edit-date');
    const platform = get('coe-edit-platform');
    const theme = get('coe-edit-theme');
    const copy = get('coe-edit-copy');
    const cta = get('coe-edit-cta');
    if (title) job.title = title.value.trim() || job.title;
    if (date) job.date = date.value || job.date;
    if (platform) job.platform = platform.value;
    if (theme) job.theme = theme.value.trim() || job.theme;
    if (copy) job.copy = copy.value;
    if (cta) job.cta = cta.value.trim() || job.cta;
    this._writeOverrides();
    this.render();
    // Cerrar el modal del editor
    const modal = document.querySelector('div[style*="position: fixed"]');
    if (modal) modal.remove();
  }

  /* ====================== Filtros ====================== */

  setFilter(key, value) {
    this.filters[key] = value;
    this.render();
  }

  get filteredJobs() {
    return this.jobs.filter((job) => {
      if (this.filters.platform !== 'all' && job.platform !== this.filters.platform) return false;
      if (this.filters.status !== 'all' && job.status !== this.filters.status) return false;
      if (this.filters.campaign !== 'all' && job.campaign !== this.filters.campaign) return false;
      return true;
    });
  }

  /* ====================== Stats ====================== */

  getStats() {
    const stats = { total: this.jobs.length, byState: {}, byPlatform: {} };
    this.jobs.forEach((job) => {
      stats.byState[job.status] = (stats.byState[job.status] || 0) + 1;
      stats.byPlatform[job.platform] = (stats.byPlatform[job.platform] || 0) + 1;
    });
    return stats;
  }

  /* ====================== Render ====================== */

  render() {
    const root = document.getElementById('coe-root');
    if (!root) return;
    const stats = this.getStats();
    const jobs = this.filteredJobs;

    // Stats cards
    root.innerHTML = `
      <div class="stats-grid mb-4" id="coe-stats">
        <div class="stat-card">
          <div class="value">${stats.total}</div>
          <div class="label">Jobs Totales</div>
        </div>
        <div class="stat-card">
          <div class="value" style="color: var(--a)">${stats.byState['DRAFT'] || 0}</div>
          <div class="label">Draft</div>
        </div>
        <div class="stat-card">
          <div class="value" style="color: #38bdf8">${stats.byState['VALIDATED'] || 0}</div>
          <div class="label">Validados</div>
        </div>
        <div class="stat-card">
          <div class="value" style="color: #fbbf24">${stats.byState['REVIEW'] || 0}</div>
          <div class="label">En Review</div>
        </div>
        <div class="stat-card">
          <div class="value" style="color: #22c55e">${stats.byState['PUBLISHED'] || 0}</div>
          <div class="label">Publicados</div>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 mb-3" id="coe-filters">
        ${this._filterSelect('platform', 'Plataforma', Object.keys(this.PLATFORM_ICONS))}
        ${this._filterSelect('status', 'Estado', this.STATES)}
        ${this._filterSelect('campaign', 'Campaña', [...new Set(this.jobs.map((j) => j.campaign))])}
        <button class="btn btn-sm" style="background: var(--bg2); color: var(--text); border: none"
          onclick="window.coeCMS.exportManifest()">
          <i class="bi bi-download me-1"></i>Export Manifest
        </button>
      </div>

      <div class="table-responsive" style="border: 1px solid var(--bg2); border-radius: 12px; overflow: hidden">
        <table class="table table-dark table-hover align-middle mb-0" style="font-size: 0.85rem">
          <thead style="background: var(--bg2)">
            <tr>
              <th style="color: var(--text-dim); font-weight: 600; padding: 0.75rem 1rem">Fecha</th>
              <th style="color: var(--text-dim); font-weight: 600">Plataforma</th>
              <th style="color: var(--text-dim); font-weight: 600">Título</th>
              <th style="color: var(--text-dim); font-weight: 600">Campaña</th>
              <th style="color: var(--text-dim); font-weight: 600">Estado</th>
              <th style="color: var(--text-dim); font-weight: 600">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${jobs.length ? jobs.map((job) => this._jobRow(job)).join('') : this._emptyRow()}
          </tbody>
        </table>
      </div>
    `;
  }

  _filterSelect(key, label, options) {
    const current = this.filters[key];
    return `
      <select class="form-select form-select-sm" style="width: auto; background: var(--bg2); color: var(--text); border: 1px solid var(--bg2)"
        onchange="window.coeCMS.setFilter('${key}', this.value)">
        <option value="all">${label}: Todos</option>
        ${options
          .map(
            (o) =>
              `<option value="${o}" ${current === o ? 'selected' : ''}>${o}</option>`,
          )
          .join('')}
      </select>
    `;
  }

  _jobRow(job) {
    const color = this.STATE_COLORS[job.status] || '#94a3b8';
    const icon = this.PLATFORM_ICONS[job.platform] || 'bi-globe';
    const next = (this.TRANSITIONS[job.status] || [])[0];
    return `
      <tr>
        <td style="padding: 0.75rem 1rem; white-space: nowrap; color: var(--text-dim)">${job.date}</td>
        <td><i class="bi ${icon} me-1" style="color: var(--p)"></i>${job.platform}</td>
        <td style="max-width: 260px">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis" title="${this._esc(job.title)}">
            ${this._esc(job.title)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-faint)">${this._esc(job.theme)}</div>
        </td>
        <td><span class="badge" style="background: var(--bg2); color: var(--text-dim)">${this._esc(job.campaign)}</span></td>
        <td>
          <span class="badge" style="background: ${color}22; color: ${color}; border: 1px solid ${color}55">
            ${job.status}
          </span>
        </td>
        <td>
          <div class="d-flex gap-1">
            ${
              next
                ? `<button class="btn btn-sm" style="background: ${color}22; color: ${color}; border: 1px solid ${color}55; font-size: 0.75rem"
                    onclick="window.coeCMS.transition('${job.id}', '${next}')">
                    <i class="bi bi-arrow-right me-1"></i>${next}
                  </button>`
                : ''
            }
            <button class="btn btn-sm" style="background: var(--bg2); color: var(--text-dim); border: none; font-size: 0.75rem"
              onclick="window.coeCMS.showDetail('${job.id}')">
              <i class="bi bi-eye"></i>
            </button>
            <button class="btn btn-sm" style="background: var(--bg2); color: var(--p); border: none; font-size: 0.75rem"
              onclick="window.coeCMS.edit('${job.id}')" title="Editar contenido">
              <i class="bi bi-pencil-square"></i>
            </button>
            ${
              job.status !== 'DRAFT'
                ? `<button class="btn btn-sm" style="background: var(--bg2); color: var(--warn); border: none; font-size: 0.75rem"
                    onclick="if(confirm('Reiniciar ${job.id} a DRAFT?')) window.coeCMS.reset('${job.id}')" title="Reiniciar a DRAFT">
                    <i class="bi bi-arrow-counterclockwise"></i>
                  </button>`
                : ''
            }
          </div>
        </td>
      </tr>
    `;
  }

  _emptyRow() {
    return `
      <tr>
        <td colspan="6" class="text-center py-4" style="color: var(--text-faint)">
          <i class="bi bi-inbox me-2"></i>Sin jobs para los filtros seleccionados
        </td>
      </tr>
    `;
  }

  /* ====================== Detalle ====================== */

  showDetail(jobId) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    const color = this.STATE_COLORS[job.status] || '#94a3b8';
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999;
      display: flex; align-items: center; justify-content: center; padding: 1rem;
    `;
    modal.innerHTML = `
      <div style="background: var(--bg1); border: 1px solid var(--bg2); border-radius: 16px;
        max-width: 640px; width: 100%; max-height: 85vh; overflow-y: auto; padding: 1.5rem">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <h5 style="margin: 0; color: var(--text)">${this._esc(job.title)}</h5>
            <div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 0.25rem">
              ${job.id} · ${job.date} · ${job.platform}
            </div>
          </div>
          <button class="btn btn-sm" style="background: var(--bg2); color: var(--text); border: none"
            onclick="this.closest('div[style]').remove()">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
        <div class="mb-3">
          <span class="badge" style="background: ${color}22; color: ${color}; border: 1px solid ${color}55">${job.status}</span>
          <span class="badge ms-1" style="background: var(--bg2); color: var(--text-dim)">${this._esc(job.campaign)}</span>
          <span class="badge ms-1" style="background: var(--bg2); color: var(--text-dim)">${this._esc(job.contentType)}</span>
        </div>
        <div class="mb-3">
          <div style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem">Copy</div>
          <div style="font-size: 0.875rem; color: var(--text-dim); white-space: pre-wrap; background: var(--bg0); border: 1px solid var(--bg2); border-radius: 8px; padding: 0.75rem">${this._esc(job.copy)}</div>
        </div>
        <div class="mb-3">
          <div style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem">CTA</div>
          <div style="font-size: 0.875rem; color: var(--a)">${this._esc(job.cta)}</div>
        </div>
        <div class="mb-3">
          <div style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem">Asset</div>
          <div style="font-size: 0.8rem; color: var(--text-dim)">${this._esc(job.asset)}</div>
        </div>
        <div class="mb-3">
          <div style="font-size: 0.75rem; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.35rem">Variantes</div>
          <div class="d-flex flex-wrap gap-1">
            ${(job.variants || [])
              .map(
                (v) =>
                  `<span class="badge" style="background: var(--bg2); color: var(--text-dim)">${v}</span>`,
              )
              .join('')}
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2 mt-4">
          <button class="btn btn-sm" style="background: linear-gradient(135deg, var(--p), var(--s)); color: var(--bg0); border: none; font-weight: 600"
            onclick="window.coeCMS.edit('${job.id}'); this.closest('div[style]').remove()">
            <i class="bi bi-pencil-square me-1"></i>Editar
          </button>
          ${
            job.status !== 'DRAFT'
              ? `<button class="btn btn-sm" style="background: var(--bg2); color: var(--warn); border: none"
                  onclick="if(confirm('Reiniciar ${job.id} a DRAFT?')) window.coeCMS.reset('${job.id}'); this.closest('div[style]').remove()">
                  <i class="bi bi-arrow-counterclockwise me-1"></i>Reiniciar a DRAFT
                </button>`
              : ''
          }
          ${(this.TRANSITIONS[job.status] || [])
            .map(
              (s) => `
                <button class="btn btn-sm" style="background: ${this.STATE_COLORS[s]}22; color: ${this.STATE_COLORS[s]}; border: 1px solid ${this.STATE_COLORS[s]}55"
                  onclick="window.coeCMS.transition('${job.id}', '${s}'); this.closest('div[style]').remove()">
                  <i class="bi bi-arrow-right me-1"></i>${s}
                </button>`,
            )
            .join('')}
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    document.body.appendChild(modal);
  }

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _escAttr(str) {
    return this._esc(str).replace(/'/g, '&#39;');
  }

  _escTextarea(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Exponer globalmente (patrón del CMS)
window.coeCMS = new COECMS();

// Auto-init cuando el DOM esté listo y la sección exista
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('coe-root')) {
    window.coeCMS.load();
    window.coeCMS.render();
    console.log('🚀 COE CMS Integration loaded:', window.coeCMS.jobs.length, 'jobs');
  }
});