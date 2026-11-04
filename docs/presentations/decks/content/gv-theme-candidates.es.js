/**
 * Direcciones visuales del canon de presentaciones: REGISTRO DE LA DECISIÓN.
 *
 * Este deck nació (octubre 2026) para comparar tres direcciones visuales
 * ANTES de construir los decks reales. La comparación se hizo, y el resultado
 * no fue un ganador único:
 *
 *   - el canon oscuro (dirección A) se adoptó como BASE: tokens, acento y
 *     gradiente de marca;
 *   - la superficie por layout (insignia de la dirección C) se quedó: portadas
 *     y divisores oscuros, contenido sobre superficie clara. Los tres decks de
 *     producción se compilan con `theme: 'hybrid'` por eso;
 *   - el deck enteramente claro (dirección B) quedó descartado.
 *
 * Lo que queda es el REGISTRO. Por eso este deck no muestra las tres
 * direcciones como specimens: solo la vigente se puede renderizar con el
 * toolkit actual.
 *
 * Regla editorial: sin contadores del repositorio. Un registro que depende de
 * números envejece y empieza a mentir; este compara PROPIEDADES DE DISEÑO.
 */

export default {
  id: 'gv-theme-candidates',
  title: 'Direcciones visuales del canon: registro de la decisión',
  subject: 'Registro de la decisión visual del canon de presentaciones',
  footer: 'Direcciones visuales: canon de presentaciones',
  theme: 'hybrid',
  slides: [
    /* ---------------- decisión ---------------- */
    {
      layout: 'statement',
      eyebrow: 'Registro de decisión',
      title: 'La dirección visual ya está decidida: canon oscuro, superficie por layout',
      body:
        'Este deck comparó tres direcciones visuales antes de construir los decks reales. La comparación se hizo y el resultado no fue un ganador único: el canon oscuro se adoptó como base, la regla de superficie por layout se quedó y el deck enteramente claro quedó descartado. Los tres decks de producción se construyen con esa combinación.',
      bodyW: 8.6,
      bodySize: 12,
      stats: [
        {
          value: 'Canon oscuro',
          label: 'Base adoptada',
          sub: 'Tokens, acento y gradiente de marca en todas las superficies',
        },
        {
          value: 'Superficie por layout',
          label: 'Regla adoptada',
          sub: 'Portadas y divisores oscuros, contenido sobre superficie clara',
        },
        {
          value: 'Claro corporativo',
          label: 'Descartado',
          sub: 'Deck enteramente claro: no se usa en el canon vigente',
        },
      ],
    },

    /* ---------------- criterios ---------------- */
    {
      layout: 'table',
      eyebrow: 'Qué se comparó',
      title: 'Los criterios que decidían la dirección',
      lead: 'Propiedades de diseño, no contadores del repositorio: los números envejecen, estas propiedades no.',
      headers: ['Criterio', 'A · Deep Field', 'B · Boardroom', 'C · Hybrid'],
      rows: [
        ['Fondo en sala con luz', 'Se pierde', 'Correcto', 'Portadas fuertes, contenido claro'],
        ['Impresión', 'No sirve', 'La opción fuerte', 'Parcial'],
        ['Acento como texto', 'Legible sobre fondo oscuro', 'Exige variante clara', 'Exige variante por superficie'],
        ['Arte de portada', 'Integrado', 'No', 'Integrado en portadas'],
        ['Estado final', 'Base del canon', 'Descartado', 'Regla de superficie'],
      ],
    },

    /* ---------------- divider ---------------- */
    {
      layout: 'section',
      number: '01',
      title: 'La dirección vigente',
      lead: 'Portada oscura con arte generado y columna de texto angosta: el texto nunca corre sobre la parte brillante del arte.',
      points: ['Canon oscuro', 'Superficie por layout', 'Arte en portada'],
    },

    /* ---------------- specimen vigente ---------------- */
    {
      layout: 'cover',
      hero: 'technical',
      eyebrow: 'Dirección vigente · canon oscuro',
      title: 'El stack de\nGentleVanguard',
      titleSize: 32,
      titleH: 1.25,
      subtitle:
        'Capa de orquestación local-first para trabajar con asistentes de IA: auditable, medible y portable.',
      meta: ['Canon oscuro', 'Gradiente de marca', 'Arte de portada'],
      versión: 'Canon vigente · 2026-11',
    },

    /* ---------------- por qué ganó ---------------- */
    {
      layout: 'bullets',
      eyebrow: 'Por qué el canon oscuro ganó',
      title: 'Cuatro razones que el claro corporativo no resolvía',
      lead: 'El color de marca tiene que funcionar como texto, no solo como superficie.',
      cols: 2,
      items: [
        {
          icon: 'eye',
          heading: 'El acento funciona como texto',
          body: 'El cian de marca mantiene contraste sobre el fondo oscuro; sobre superficie clara usa su variante oscura.',
        },
        {
          icon: 'layers',
          heading: 'Un juego de tokens, no colores sueltos',
          body: 'Fondo, superficie, acento y texto salen de los tokens del canon, con su variante por superficie.',
        },
        {
          icon: 'bolt',
          heading: 'Se ve igual en sala y en pantalla',
          body: 'La superficie clara de contenido mantiene el deck legible en una sala iluminada.',
        },
        {
          icon: 'shield',
          heading: 'El gate de color lo hace cumplir',
          body: 'Un acento crudo usado como texto sobre superficie clara falla el gate: no depende de la memoria de nadie.',
        },
      ],
    },

    /* ---------------- qué exige hoy ---------------- */
    {
      layout: 'bullets',
      eyebrow: 'Qué exige hoy un slide del canon',
      title: 'Las reglas que un deck nuevo tiene que cumplir',
      lead: 'Son las mismas que aplican los gates del stack.',
      cols: 2,
      items: [
        {
          icon: 'diagram',
          heading: 'Layout, no coordenadas',
          body: 'El contenido declara la idea; el layout decide la geometría. Ningún slide lleva coordenadas.',
        },
        {
          icon: 'tools',
          heading: 'Arte con velo horneado',
          body: 'La portada usa arte generado y un velo oscuro horneado en el píxel: PowerPoint no tiene relleno degradado.',
        },
        {
          icon: 'brain',
          heading: 'Diagramas nativos',
          body: 'Un diagrama que lleva información se arma con formas y texto, no con una imagen rasterizada.',
        },
        {
          icon: 'file',
          heading: 'Copy verificable',
          body: 'Lo afirmado sale del repositorio; lo que no se puede verificar no se escribe.',
        },
      ],
    },

    /* ---------------- cierre ---------------- */
    {
      layout: 'closing',
      title: 'Una base, una regla, un juego de layouts',
      body:
        'Todo deck nuevo sale del mismo canon: los mismos tokens, la misma regla de superficie y los mismos gates. Si el canon cambia, se cambia una vez y todos los decks lo siguen.',
      ctas: [{ label: 'Toolkit de presentaciones' }, { label: 'Skill gv-presentations' }],
      note: 'Este deck es un registro interno de decisión de diseño, no material de venta.',
    },
  ],
};
