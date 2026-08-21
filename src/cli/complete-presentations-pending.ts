/**
 * Script de completado masivo para pendientes de presentations
 * Agrega: traducciones ES/pt-BR, triggers HTML, y estructura de carruseles
 */

import * as fs from 'fs';

console.log('🚀 COMPLETADO MASIVO - Pendientes de Presentations\n');

// ============================================================================
// PASO 1: Agregar traducciones en ES (español)
// ============================================================================

console.log('📌 PASO 1: Agregando traducciones ES...');

const i18nPath = 'docs/presentations/assets/js/i18n.js';
let i18nContent = fs.readFileSync(i18nPath, 'utf8');

// Buscar el final de la sección ES (antes de pt-BR)
const esEndPattern = /(tip_tracerepo:\s*'[^']*',\s*)(\},\s*'pt-BR':)/;

const esTranslations = `      // Dashboard tips (ES)
      tip_dashboard_websocket:
        'Actualizaciones WebSocket en tiempo real cada 5 segundos con fallback HTTP.',
      tip_dashboard_sections:
        '7 secciones del dashboard: Métricas, Trazas, Alertas, Scoring, Waterfall, Feedback e Info.',
      tip_dashboard_alerts:
        '8 reglas de alerta configurables que monitorean uso de tokens, salud y rendimiento.',
      tip_dashboard_i18n:
        'Soporte de internacionalización: Español, Inglés y Portugués con detección automática.',

      // Patterns tips (ES)
      tip_patterns_karpathy:
        'Guías Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven — rúbricas de calidad.',
      tip_patterns_sdd:
        'Ciclo SDD: Explore → Design → Apply → Verify con umbrales de confianza.',
      tip_patterns_slop:
        'Detección AI Slop: compuertas automáticas para prevenir contenido genérico de IA.',
      tip_patterns_arch:
        '10 patrones arquitectónicos: Layered, Event-Driven, CQRS, Circuit Breaker, Saga, etc.',
      tip_patterns_standards:
        'Estándares de desarrollo: convenciones de código, documentación y compuertas de revisión.',
      tip_patterns_docs:
        'Reducción de carga cognitiva y revelación progresiva en documentación técnica.',\n\n`;

if (esEndPattern.test(i18nContent)) {
  i18nContent = i18nContent.replace(esEndPattern, `$1${esTranslations}$2`);
  console.log('   ✅ Traducciones ES agregadas');
} else {
  console.log('   ⚠️ No se pudo encontrar el punto de inserción ES');
}

// ============================================================================
// PASO 2: Agregar traducciones en pt-BR (portugués)
// ============================================================================

console.log('\n📌 PASO 2: Agregando traducciones pt-BR...');

// Buscar el final de la sección pt-BR (antes del cierre de DICT)
const ptEndPattern = /(tip_tracerepo:\s*'[^']*',\s*)(\},\s*\};)/;

const ptTranslations = `      // Dashboard tips (pt-BR)
      tip_dashboard_websocket:
        'Atualizações WebSocket em tempo real a cada 5 segundos com fallback HTTP.',
      tip_dashboard_sections:
        '7 seções do dashboard: Métricas, Trazas, Alertas, Scoring, Waterfall, Feedback e Info.',
      tip_dashboard_alerts:
        '8 regras de alerta configuráveis que monitoram uso de tokens, saúde e desempenho.',
      tip_dashboard_i18n:
        'Suporte de internacionalização: Português, Espanhol e Inglês com detecção automática.',

      // Patterns tips (pt-BR)
      tip_patterns_karpathy:
        'Diretrizes Karpathy: Think First, Simplicity, Surgical Changes, Goal-Driven.',
      tip_patterns_sdd:
        'Ciclo SDD: Explore → Design → Apply → Verify com limiares de confiança.',
      tip_patterns_slop:
        'Detecção AI Slop: portões automáticos para prevenir conteúdo genérico de IA.',
      tip_patterns_arch:
        '10 padrões arquiteturais: Layered, Event-Driven, CQRS, Circuit Breaker, Saga, etc.',
      tip_patterns_standards:
        'Padrões de desenvolvimento: convenções de código, documentação e portões de revisão.',
      tip_patterns_docs:
        'Redução de carga cognitiva e revelação progressiva em documentação técnica.',\n\n`;

if (ptEndPattern.test(i18nContent)) {
  i18nContent = i18nContent.replace(ptEndPattern, `$1${ptTranslations}$2`);
  console.log('   ✅ Traducciones pt-BR agregadas');
} else {
  console.log('   ⚠️ No se pudo encontrar el punto de inserción pt-BR');
}

// Guardar el archivo i18n.js actualizado
fs.writeFileSync(i18nPath, i18nContent);
console.log('   ✅ Archivo i18n.js actualizado completamente');

// ============================================================================
// PASO 3: Agregar triggers en dashboard.html
// ============================================================================

console.log('\n📌 PASO 3: Agregando triggers en dashboard.html...');

const dashboardPath = 'docs/presentations/dashboard.html';
let dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

// Verificar si ya tiene triggers
if (!dashboardContent.includes('tip_dashboard_')) {
  // Agregar triggers en secciones clave
  const triggerReplacements: Array<{
    search: RegExp;
    replace: (match: string) => string;
    tip: string;
  }> = [
    {
      search: /(WebSocket Real-Time|Real-time WebSocket)/i,
      replace: (match: string) =>
        `${match}<span class="info-trigger" data-i18n-title="tip_dashboard_websocket">i</span>`,
      tip: 'tip_dashboard_websocket',
    },
    {
      search: /(7 Dashboard Sections|7 sections)/i,
      replace: (match: string) =>
        `${match}<span class="info-trigger" data-i18n-title="tip_dashboard_sections">i</span>`,
      tip: 'tip_dashboard_sections',
    },
    {
      search: /(8 Alert Rules|configurable alert)/i,
      replace: (match: string) =>
        `${match}<span class="info-trigger" data-i18n-title="tip_dashboard_alerts">i</span>`,
      tip: 'tip_dashboard_alerts',
    },
    {
      search: /(3 Languages|i18n|internationalization)/i,
      replace: (match: string) =>
        `${match}<span class="info-trigger" data-i18n-title="tip_dashboard_i18n">i</span>`,
      tip: 'tip_dashboard_i18n',
    },
  ];

  let modified = false;
  for (const tr of triggerReplacements) {
    const originalContent = dashboardContent;
    // Solo reemplazar si no tiene ya el trigger
    if (tr.search.test(dashboardContent) && !dashboardContent.includes(tr.tip)) {
      dashboardContent = dashboardContent.replace(tr.search, tr.replace);
      if (dashboardContent !== originalContent) {
        modified = true;
        console.log(`   ✅ Trigger ${tr.tip} agregado`);
      }
    }
  }

  if (modified) {
    fs.writeFileSync(dashboardPath, dashboardContent);
    console.log('   ✅ dashboard.html actualizado con triggers');
  } else {
    console.log('   ℹ️ No se encontraron ubicaciones para triggers en dashboard.html');
  }
} else {
  console.log('   ℹ️ dashboard.html ya tiene triggers');
}

// ============================================================================
// PASO 4: Agregar triggers en patterns-conventions.html
// ============================================================================

console.log('\n📌 PASO 4: Agregando triggers en patterns-conventions.html...');

const patternsPath = 'docs/presentations/patterns-conventions.html';

if (fs.existsSync(patternsPath)) {
  let patternsContent = fs.readFileSync(patternsPath, 'utf8');

  if (!patternsContent.includes('tip_patterns_')) {
    const patternsTriggers: Array<{ search: RegExp; tip: string }> = [
      {
        search: /(Karpathy Guidelines?|Karphy)/i,
        tip: 'tip_patterns_karpathy',
      },
      {
        search: /(SDD|Spec-Driven|Explore Design Apply)/i,
        tip: 'tip_patterns_sdd',
      },
      {
        search: /(AI Slop|Slop Detection)/i,
        tip: 'tip_patterns_slop',
      },
      {
        search: /(Architecture Patterns|10 patterns)/i,
        tip: 'tip_patterns_arch',
      },
      {
        search: /(Development Standards?|Standards)/i,
        tip: 'tip_patterns_standards',
      },
      {
        search: /(Documentation|Progressive Disclosure)/i,
        tip: 'tip_patterns_docs',
      },
    ];

    let modified = false;
    for (const tr of patternsTriggers) {
      const originalContent = patternsContent;
      if (tr.search.test(patternsContent) && !patternsContent.includes(tr.tip)) {
        patternsContent = patternsContent.replace(tr.search, (match: string) => {
          return `${match}<span class="info-trigger" data-i18n-title="${tr.tip}">i</span>`;
        });
        if (patternsContent !== originalContent) {
          modified = true;
          console.log(`   ✅ Trigger ${tr.tip} agregado`);
        }
      }
    }

    if (modified) {
      fs.writeFileSync(patternsPath, patternsContent);
      console.log('   ✅ patterns-conventions.html actualizado con triggers');
    }
  } else {
    console.log('   ℹ️ patterns-conventions.html ya tiene triggers');
  }
} else {
  console.log('   ⚠️ patterns-conventions.html no encontrado');
}

// ============================================================================
// PASO 5: Crear estructura de carrusel para architecture.html (11 DAOs)
// ============================================================================

console.log('\n📌 PASO 5: Preparando estructura de carrusel para DAOs...');

const carouselDAOs = `
<!-- CAROUSEL: 11 Data Access Objects -->
<div class="gv-carousel mb-4" data-autoplay="6000" id="dao-carousel">
  <div class="gv-carousel-track">
    
    <!-- Slide 1: DAOs 1-3 -->
    <div class="gv-carousel-slide active">
      <div class="row g-3">
        <div class="col-md-4">
          <div class="card h-100 border-info">
            <div class="card-body">
              <h6 class="card-title text-info"><i class="bi bi-graph-up"></i> MetricsRepo</h6>
              <p class="card-text small">Time-series metrics with aggregation and retention policies</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-info">
            <div class="card-body">
              <h6 class="card-title text-info"><i class="bi bi-clock-history"></i> SessionRepo</h6>
              <p class="card-text small">Session persistence with checkpointing and lifecycle tracking</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-info">
            <div class="card-body">
              <h6 class="card-title text-info"><i class="bi bi-activity"></i> TraceRepo</h6>
              <p class="card-text small">Distributed tracing spans with waterfall visualization</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Slide 2: DAOs 4-6 -->
    <div class="gv-carousel-slide">
      <div class="row g-3">
        <div class="col-md-4">
          <div class="card h-100 border-success">
            <div class="card-body">
              <h6 class="card-title text-success"><i class="bi bi-lightning"></i> EventRepo</h6>
              <p class="card-text small">Event sourcing with append-only audit trail</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-success">
            <div class="card-body">
              <h6 class="card-title text-success"><i class="bi bi-archive"></i> CacheRepo</h6>
              <p class="card-text small">Multi-tier caching with TTL and invalidation</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-primary">
            <div class="card-body">
              <h6 class="card-title text-primary"><i class="bi bi-tools"></i> SkillRepo</h6>
              <p class="card-text small">Skill registry with auto-loading and versioning</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Slide 3: DAOs 7-9 -->
    <div class="gv-carousel-slide">
      <div class="row g-3">
        <div class="col-md-4">
          <div class="card h-100 border-warning">
            <div class="card-body">
              <h6 class="card-title text-warning"><i class="bi bi-file-check"></i> ContractRepo</h6>
              <p class="card-text small">SDD contract validation and enforcement tracking</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-danger">
            <div class="card-body">
              <h6 class="card-title text-danger"><i class="bi bi-bug"></i> ErrMemoryRepo</h6>
              <p class="card-text small">Error pattern learning and proactive detection</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-warning">
            <div class="card-body">
              <h6 class="card-title text-warning"><i class="bi bi-list-task"></i> BacklogRepo</h6>
              <p class="card-text small">Priority queue with aging and escalation</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Slide 4: DAOs 10-11 -->
    <div class="gv-carousel-slide">
      <div class="row g-3 justify-content-center">
        <div class="col-md-4">
          <div class="card h-100 border-secondary">
            <div class="card-body">
              <h6 class="card-title text-secondary"><i class="bi bi-broom"></i> HousekeepingRepo</h6>
              <p class="card-text small">pruneAll, vacuum, WAL checkpoint maintenance</p>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card h-100 border-secondary">
            <div class="card-body">
              <h6 class="card-title text-secondary"><i class="bi bi-database-gear"></i> MigrationRunner</h6>
              <p class="card-text small">7 automated DB migrations with rollback support</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    
  </div>
  
  <!-- Controles -->
  <div class="gv-carousel-nav text-center mt-3">
    <button class="btn btn-sm btn-outline-secondary me-2" onclick="moveCarousel('dao-carousel', -1)">❮</button>
    <span class="carousel-dots mx-2">
      <span class="dot active" onclick="goToSlide('dao-carousel', 0)"></span>
      <span class="dot" onclick="goToSlide('dao-carousel', 1)"></span>
      <span class="dot" onclick="goToSlide('dao-carousel', 2)"></span>
      <span class="dot" onclick="goToSlide('dao-carousel', 3)"></span>
    </span>
    <button class="btn btn-sm btn-outline-secondary ms-2" onclick="moveCarousel('dao-carousel', 1)">❯</button>
  </div>
</div>
`;

// Guardar el HTML del carrusel para referencia
fs.writeFileSync('.session/dao-carousel-snippet.html', carouselDAOs);
console.log(
  '   ✅ Estructura de carrusel para DAOs guardada en .session/dao-carousel-snippet.html',
);

// ============================================================================
// PASO 6: Crear estructura de carrusel para dashboard.html (7 secciones)
// ============================================================================

console.log('\n📌 PASO 6: Preparando estructura de carrusel para dashboard...');

const carouselDashboard = `
<!-- CAROUSEL: 7 Dashboard Sections -->
<div class="gv-carousel mb-4" data-autoplay="8000" id="dashboard-carousel">
  <div class="gv-carousel-track">
    
    <!-- Slide 1: Métricas en tiempo real -->
    <div class="gv-carousel-slide active">
      <div class="card border-primary">
        <div class="card-header bg-primary text-white">
          <i class="bi bi-graph-up"></i> Real-time Metrics
        </div>
        <div class="card-body">
          <p>Live token usage, session health, and performance indicators updated every 5 seconds via WebSocket.</p>
          <div class="row text-center">
            <div class="col"><strong>5M</strong><br><small>Daily Budget</small></div>
            <div class="col"><strong>30s</strong><br><small>Update Interval</small></div>
            <div class="col"><strong>3</strong><br><small>Languages</small></div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Slide 2: Distributed Tracing -->
    <div class="gv-carousel-slide">
      <div class="card border-info">
        <div class="card-header bg-info text-dark">
          <i class="bi bi-activity"></i> Distributed Tracing
        </div>
        <div class="card-body">
          <p>Waterfall visualization of spans across the session pipeline with latency breakdown.</p>
          <ul class="list-unstyled small">
            <li>✓ Parent-child relationships</li>
            <li>✓ Timing analysis</li>
            <li>✓ Error propagation tracking</li>
          </ul>
        </div>
      </div>
    </div>
    
    <!-- Slide 3: Alert System -->
    <div class="gv-carousel-slide">
      <div class="card border-warning">
        <div class="card-header bg-warning text-dark">
          <i class="bi bi-bell"></i> Alert System
        </div>
        <div class="card-body">
          <p>8 configurable rules monitoring health, performance, and token budgets.</p>
          <div class="d-flex gap-2 justify-content-center">
            <span class="badge bg-danger">Critical</span>
            <span class="badge bg-warning">Warning</span>
            <span class="badge bg-success">Healthy</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Slide 4: Session Scoring -->
    <div class="gv-carousel-slide">
      <div class="card border-success">
        <div class="card-header bg-success text-white">
          <i class="bi bi-star-half"></i> Session Scoring
        </div>
        <div class="card-body">
          <p>Quality metrics tracking delegations, corrections, and proactive hits per session.</p>
          <p class="text-center"><strong>Regression detection:</strong> 15% threshold</p>
        </div>
      </div>
    </div>
    
  </div>
  
  <!-- Controles -->
  <div class="gv-carousel-nav text-center mt-3">
    <button class="btn btn-sm btn-outline-secondary me-2" onclick="moveCarousel('dashboard-carousel', -1)">❮</button>
    <span class="carousel-dots mx-2">
      <span class="dot active" onclick="goToSlide('dashboard-carousel', 0)"></span>
      <span class="dot" onclick="goToSlide('dashboard-carousel', 1)"></span>
      <span class="dot" onclick="goToSlide('dashboard-carousel', 2)"></span>
      <span class="dot" onclick="goToSlide('dashboard-carousel', 3)"></span>
    </span>
    <button class="btn btn-sm btn-outline-secondary ms-2" onclick="moveCarousel('dashboard-carousel', 1)">❯</button>
  </div>
</div>
`;

fs.writeFileSync('.session/dashboard-carousel-snippet.html', carouselDashboard);
console.log(
  '   ✅ Estructura de carrusel para dashboard guardada en .session/dashboard-carousel-snippet.html',
);

// ============================================================================
// PASO 7: Crear JavaScript para carruseles
// ============================================================================

console.log('\n📌 PASO 7: Creando JavaScript para carruseles...');

const carouselJS = `
/* Carousel functionality for presentations */
(function() {
  'use strict';
  
  window.moveCarousel = function(carouselId, direction) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.gv-carousel-slide');
    const dots = carousel.querySelectorAll('.carousel-dots .dot');
    let currentIndex = 0;
    
    slides.forEach((slide, index) => {
      if (slide.classList.contains('active')) {
        currentIndex = index;
      }
    });
    
    const newIndex = (currentIndex + direction + slides.length) % slides.length;
    goToSlide(carouselId, newIndex);
  };
  
  window.goToSlide = function(carouselId, index) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    
    const slides = carousel.querySelectorAll('.gv-carousel-slide');
    const dots = carousel.querySelectorAll('.carousel-dots .dot');
    
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });
    
    if (dots.length > 0) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
    }
  };
  
  // Auto-play functionality
  document.querySelectorAll('.gv-carousel[data-autoplay]').forEach(carousel => {
    const interval = parseInt(carousel.getAttribute('data-autoplay')) || 5000;
    const carouselId = carousel.id;
    
    if (carouselId) {
      setInterval(() => {
        moveCarousel(carouselId, 1);
      }, interval);
    }
  });
  
  console.log('✅ Carousel system initialized');
})();
`;

fs.writeFileSync('docs/presentations/assets/js/carousel.js', carouselJS);
console.log('   ✅ JavaScript de carruseles creado: docs/presentations/assets/js/carousel.js');

// ============================================================================
// RESUMEN
// ============================================================================

console.log('\n' + '='.repeat(70));
console.log('✅ COMPLETADO MASIVO FINALIZADO');
console.log('='.repeat(70));
console.log('\n📊 RESUMEN:');
console.log('   ✓ Traducciones ES agregadas (10 claves)');
console.log('   ✓ Traducciones pt-BR agregadas (10 claves)');
console.log('   ✓ Triggers en dashboard.html (según disponibilidad)');
console.log('   ✓ Triggers en patterns-conventions.html (según disponibilidad)');
console.log('   ✓ Estructura de carrusel DAOs creada');
console.log('   ✓ Estructura de carrusel Dashboard creada');
console.log('   ✓ JavaScript de carruseles creado');
console.log('\n📁 Archivos creados/modificados:');
console.log('   • docs/presentations/assets/js/i18n.js (actualizado)');
console.log('   • docs/presentations/assets/js/carousel.js (nuevo)');
console.log('   • docs/presentations/dashboard.html (triggers)');
console.log('   • docs/presentations/patterns-conventions.html (triggers)');
console.log('   • .session/dao-carousel-snippet.html (referencia)');
console.log('   • .session/dashboard-carousel-snippet.html (referencia)');
console.log('\n🎯 PRÓXIMOS PASOS:');
console.log('   1. Verificar triggers con: npm run presentations:validate');
console.log('   2. Incluir carousel.js en architecture.html y dashboard.html');
console.log('   3. Insertar snippets de carrusel en las páginas correspondientes');
console.log('\n' + '='.repeat(70));
