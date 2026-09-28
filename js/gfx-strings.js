// River Stakes — localized strings for the Graphics settings section.
// The rest of the game is English-only; this panel follows navigator.language.

const EN_US = {
  heading: 'Graphics',
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  categories: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom (lantern glow)', grade: 'Color grade and vignette',
    antialias: 'Anti-aliasing', particles: 'Particles', water: 'River water', detail: 'Surface detail',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Still', animated: 'Animated',
    plain: 'Plain', detailed: 'Detailed',
  },
  adaptive: 'Adaptive resolution',
  showFps: 'Show frame rate',
  postUnavailable: 'Post-processing is unavailable on this device, so the table renders without it.',
  no3d: '3D view unavailable — the table is shown without it.',
  unknownGpu: 'unknown GPU',
  describe: {
    noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion',
    aoHigh: 'full ambient occlusion', bloom: 'bloom', noAa: 'no anti-aliasing', px: '{w}×{h} px',
  },
};

const EN_GB = {
  ...EN_US,
  categories: { ...EN_US.categories, grade: 'Colour grade and vignette' },
  postUnavailable: 'Post-processing is unavailable on this device, so the table renders without it.',
};

const ES_419 = {
  heading: 'Gráficos',
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Escala de renderizado',
  fromPreset: 'Del ajuste ({tier})',
  categories: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor (faroles)', grade: 'Gradación de color y viñeta',
    antialias: 'Antialiasing', particles: 'Partículas', water: 'Agua del río', detail: 'Detalle de superficies',
  },
  tiers: {
    off: 'Desactivado', on: 'Activado', low: 'Bajo', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Quieta', animated: 'Animada',
    plain: 'Simple', detailed: 'Detallado',
  },
  adaptive: 'Resolución adaptable',
  showFps: 'Mostrar cuadros por segundo',
  postUnavailable: 'El posprocesamiento no está disponible en este dispositivo; la mesa se muestra sin él.',
  no3d: 'Vista 3D no disponible: la mesa se muestra sin ella.',
  unknownGpu: 'GPU desconocida',
  describe: {
    noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental',
    aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', noAa: 'sin antialiasing', px: '{w}×{h} px',
  },
};

const ES_ES = {
  ...ES_419,
  auto: 'Automática (detectada: {tier})',
  renderScale: 'Escala de renderizado',
  showFps: 'Mostrar fotogramas por segundo',
  adaptive: 'Resolución adaptativa',
  tiers: { ...ES_419.tiers, off: 'Desactivado', on: 'Activado' },
};

const DE = {
  heading: 'Grafik',
  quality: 'Qualität',
  auto: 'Automatisch (erkannt: {tier})',
  presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
  renderScale: 'Renderskalierung',
  fromPreset: 'Voreinstellung ({tier})',
  categories: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom (Laternenschein)', grade: 'Farbkorrektur und Vignette',
    antialias: 'Kantenglättung', particles: 'Partikel', water: 'Flusswasser', detail: 'Oberflächendetails',
  },
  tiers: {
    off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Ruhig', animated: 'Animiert',
    plain: 'Schlicht', detailed: 'Detailliert',
  },
  adaptive: 'Adaptive Auflösung',
  showFps: 'Bildrate anzeigen',
  postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; der Tisch wird ohne sie dargestellt.',
  no3d: '3D-Ansicht nicht verfügbar – der Tisch wird ohne sie angezeigt.',
  unknownGpu: 'unbekannte GPU',
  describe: {
    noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung',
    aoHigh: 'volle Umgebungsverdeckung', bloom: 'Bloom', noAa: 'keine Kantenglättung', px: '{w}×{h} px',
  },
};

const FR = {
  heading: 'Graphismes',
  quality: 'Qualité',
  auto: 'Auto (détectée : {tier})',
  presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
  renderScale: 'Échelle de rendu',
  fromPreset: 'Préréglage ({tier})',
  categories: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo (lanternes)', grade: 'Étalonnage et vignettage',
    antialias: 'Anticrénelage', particles: 'Particules', water: 'Eau de la rivière', detail: 'Détail des surfaces',
  },
  tiers: {
    off: 'Désactivé', on: 'Activé', low: 'Bas', medium: 'Moyen', high: 'Élevé',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Immobile', animated: 'Animée',
    plain: 'Simple', detailed: 'Détaillé',
  },
  adaptive: 'Résolution adaptative',
  showFps: 'Afficher la fréquence d’images',
  postUnavailable: 'Le post-traitement n’est pas disponible sur cet appareil ; la table s’affiche sans lui.',
  no3d: 'Vue 3D indisponible : la table s’affiche sans elle.',
  unknownGpu: 'GPU inconnu',
  describe: {
    noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante',
    aoHigh: 'occlusion ambiante complète', bloom: 'halo', noAa: 'sans anticrénelage', px: '{w}×{h} px',
  },
};

const FR_CA = {
  ...FR,
  showFps: 'Afficher le nombre d’images par seconde',
  categories: { ...FR.categories, antialias: 'Anticrénelage' },
};

const PT_BR = {
  heading: 'Gráficos',
  quality: 'Qualidade',
  auto: 'Automática (detectada: {tier})',
  presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Escala de renderização',
  fromPreset: 'Predefinição ({tier})',
  categories: {
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho (lanternas)', grade: 'Correção de cor e vinheta',
    antialias: 'Antisserrilhado', particles: 'Partículas', water: 'Água do rio', detail: 'Detalhe das superfícies',
  },
  tiers: {
    off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Parada', animated: 'Animada',
    plain: 'Simples', detailed: 'Detalhado',
  },
  adaptive: 'Resolução adaptável',
  showFps: 'Mostrar taxa de quadros',
  postUnavailable: 'O pós-processamento não está disponível neste dispositivo; a mesa é exibida sem ele.',
  no3d: 'Visão 3D indisponível: a mesa é exibida sem ela.',
  unknownGpu: 'GPU desconhecida',
  describe: {
    noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente',
    aoHigh: 'oclusão ambiente completa', bloom: 'brilho', noAa: 'sem antisserrilhado', px: '{w}×{h} px',
  },
};

const IT = {
  heading: 'Grafica',
  quality: 'Qualità',
  auto: 'Automatica (rilevata: {tier})',
  presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
  renderScale: 'Scala di rendering',
  fromPreset: 'Dal preset ({tier})',
  categories: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore (lanterne)', grade: 'Correzione colore e vignettatura',
    antialias: 'Anti-aliasing', particles: 'Particelle', water: 'Acqua del fiume', detail: 'Dettaglio superfici',
  },
  tiers: {
    off: 'Disattivato', on: 'Attivato', low: 'Basso', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Ferma', animated: 'Animata',
    plain: 'Semplice', detailed: 'Dettagliato',
  },
  adaptive: 'Risoluzione adattiva',
  showFps: 'Mostra frequenza fotogrammi',
  postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; il tavolo viene mostrato senza.',
  no3d: 'Vista 3D non disponibile: il tavolo viene mostrato senza.',
  unknownGpu: 'GPU sconosciuta',
  describe: {
    noShadows: 'nessuna ombra', shadows: 'ombre {n}²', ao: 'occlusione ambientale',
    aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', noAa: 'nessun anti-aliasing', px: '{w}×{h} px',
  },
};

export const GFX_STRINGS = {
  'en-US': EN_US, 'en-GB': EN_GB, 'es-419': ES_419, 'es-ES': ES_ES, 'de-DE': DE,
  'fr-FR': FR, 'fr-CA': FR_CA, 'pt-BR': PT_BR, 'it-IT': IT,
};

const BASE = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the best supported locale for a BCP-47 tag (e.g. 'es-MX' → 'es-419', 'en-AU' → 'en-GB'). */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  if (GFX_STRINGS[t]) return t;
  const [lang, region = ''] = t.split('-');
  const l = lang.toLowerCase();
  const r = region.toUpperCase();
  if (l === 'en' && ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(r)) return 'en-GB';
  if (l === 'es' && r === 'ES') return 'es-ES';
  if (l === 'fr' && r === 'CA') return 'fr-CA';
  if (l === 'pt') return 'pt-BR';
  return BASE[l] || 'en-US';
}

/** Graphics strings for a locale tag (navigator.language when omitted). */
export function gfxStrings(tag) {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return GFX_STRINGS[pickLocale(tag || nav)];
}
