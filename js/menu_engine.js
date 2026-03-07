/**
 * menu_engine.js
 * Moteur de génération déterministe des menus hebdomadaires.
 * Aucune dépendance externe. Compatible navigateur et GitHub Pages.
 *
 * Exports (window.*) :
 *   getISOWeek(date?) → number
 *   generateWeekFromRecipes(recipes, mode, weekNum?) → Recipe[]
 */

'use strict';

/* ─────────────────────────────────────────────
   GÉNÉRATEUR PSEUDO-ALÉATOIRE DÉTERMINISTE
   Mulberry32 — seed basé sur (mode + numéro de semaine)
   Garantit la stabilité des menus pendant toute la semaine.
   ───────────────────────────────────────────── */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─────────────────────────────────────────────
   CALCUL DU NUMÉRO DE SEMAINE ISO 8601
   Lundi = début de semaine.
   ───────────────────────────────────────────── */
function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Dim = 7 au lieu de 0
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/* ─────────────────────────────────────────────
   SÉLECTION PARMI LES MEILLEURS CANDIDATS
   Top-5 scorés → tirage pseudo-aléatoire stable
   ───────────────────────────────────────────── */
function pickBest(candidates, rng) {
  if (!candidates.length) return null;
  const scored = [...candidates].sort(
    (a, b) => b.__score - a.__score || a.nom.localeCompare(b.nom)
  );
  const top = scored.slice(0, Math.min(5, scored.length));
  return top[Math.floor(rng() * top.length)];
}

/* ─────────────────────────────────────────────
   SIGNATURE D'INGRÉDIENTS
   Permet de détecter les plats trop similaires
   (mêmes 3 premiers ingrédients).
   ───────────────────────────────────────────── */
function ingredientSignature(recipe) {
  return recipe.ingredients
    .slice(0, 3)
    .map((i) => i.ingredient)
    .sort()
    .join('|');
}

/* ─────────────────────────────────────────────
   DÉFINITION DES JOURS ET LEURS CONTRAINTES
   ───────────────────────────────────────────── */
const DAYS_CONFIG = [
  {
    key: 'lundi',
    label: 'LUN soir',
    needs: { proteine: 'poisson', conservation: 'frigo', jour: 'lundi' },
  },
  {
    key: 'mardi',
    label: 'MAR soir',
    needs: { conservation: 'frigo' },
  },
  {
    key: 'mercredi',
    label: 'MER soir',
    needs: { conservation: 'frigo', preferTypes: ['soupe', 'legumineuse', 'vegetarien'] },
  },
  {
    key: 'jeudi',
    label: 'JEU soir',
    needs: { conservation: 'congelable' },
  },
  {
    key: 'vendredi',
    label: 'VEN soir',
    needs: { conservation: 'congelable' },
  },
  {
    key: 'samedi',
    label: 'SAM soir',
    needs: { conservation: 'congelable' },
  },
];

/* ─────────────────────────────────────────────
   GÉNÉRATION D'UNE SEMAINE COMPLÈTE
   @param recipes   — tableau des recettes JSON
   @param mode      — 'enfants' | 'sans_enfants'
   @param weekNum   — numéro ISO de la semaine (défaut = semaine courante)
   @returns         — tableau de 6 recettes (lun→sam)
   ───────────────────────────────────────────── */
function generateWeekFromRecipes(
  recipes,
  mode = 'sans_enfants',
  weekNum = getISOWeek()
) {
  // Seed différent pour chaque mode afin que les deux semaines
  // (avec/sans enfants) soient indépendantes.
  const SEED_OFFSET = mode === 'enfants' ? 1000 : 2000;
  const rng = mulberry32(SEED_OFFSET + weekNum);

  // Pondérations de catégories selon le mode
  const catWeights =
    mode === 'enfants'
      ? { familial: 4, plaisir: 3, quotidien: 1 }
      : { quotidien: 4, familial: 1, plaisir: -1 };

  const maxPlaisir = mode === 'enfants' ? 2 : 1;
  const maxFamilial = mode === 'enfants' ? 3 : 2;

  // Compteurs anti-répétition
  const usedIds = new Set();
  const protCount = {};
  const baseCount = {};
  const ingCount = {};
  let plaisirCount = 0;
  let familialCount = 0;
  let soupCount = 0;
  let vegCount = 0;

  const result = [];

  for (const day of DAYS_CONFIG) {
    // ── 1. Filtrage initial des candidats ──────────────────────────
    let candidates = recipes.filter(
      (r) => r.compatible_lunchbox !== false && !usedIds.has(r.id)
    );

    // Contraintes du jour
    candidates = candidates.filter((r) => {
      const { needs } = day;

      if (needs.proteine && r.proteine_principale !== needs.proteine) return false;

      if (needs.jour && r.jour_autorise !== 'tous' && r.jour_autorise !== needs.jour)
        return false;

      if (needs.conservation) {
        const c = r.conservation;
        if (needs.conservation === 'frigo' && c !== 'frigo' && c !== 'les_deux')
          return false;
        if (
          needs.conservation === 'congelable' &&
          c !== 'les_deux' &&
          c !== 'congelable'
        )
          return false;
      }

      // Limites globales
      if (plaisirCount >= maxPlaisir && r.categorie === 'plaisir') return false;
      if (familialCount >= maxFamilial && r.categorie === 'familial' && mode === 'enfants')
        return false;
      if ((protCount[r.proteine_principale] || 0) >= 2) return false;
      if ((baseCount[r.base_cuisson || 'aucun'] || 0) >= 2) return false;

      return true;
    });

    // ── 2. Scoring des candidats ───────────────────────────────────
    candidates = candidates.map((r) => {
      let score = 0;

      // Bonus catégorie selon mode
      score += catWeights[r.categorie] || 0;

      // Bonus affinité jour (mercredi préfère soupe/veg)
      if (day.needs.preferTypes) {
        if (day.needs.preferTypes.includes(r.type_plat)) score += 4;
        if (day.needs.preferTypes.includes(r.proteine_principale)) score += 4;
      }

      // Anti-répétition vs plat précédent
      if (result.length > 0) {
        const prev = result[result.length - 1];
        if (prev.type_plat === r.type_plat) score -= 3;
        if (prev.base_cuisson === r.base_cuisson) score -= 2;
        if (prev.proteine_principale === r.proteine_principale) score -= 2;
        if (ingredientSignature(prev) === ingredientSignature(r)) score -= 5;
      }

      // Anti-répétition ingrédients sur toute la semaine
      for (const ing of r.ingredients.slice(0, 3)) {
        score -= (ingCount[ing.ingredient] || 0) * 1.5;
      }

      // Limiter les soupes à 1
      if (r.type_plat === 'soupe' && soupCount >= 1) score -= 8;

      // Bonus pour le premier plat végétarien/légumineuse
      if (
        (r.proteine_principale === 'vegetarien' ||
          r.proteine_principale === 'legumineuse') &&
        vegCount === 0
      )
        score += 2;

      return { ...r, __score: score };
    });

    // ── 3. Sélection ───────────────────────────────────────────────
    let chosen = pickBest(candidates, rng);

    // Fallback sans contraintes si aucun candidat trouvé
    if (!chosen) {
      const fallbacks = recipes
        .filter((r) => !usedIds.has(r.id))
        .map((r) => ({ ...r, __score: 0 }));
      chosen = pickBest(fallbacks, rng);
    }

    if (!chosen) {
      throw new Error(
        `Impossible de générer un menu pour ${day.key} (semaine ${weekNum}, mode ${mode})`
      );
    }

    // ── 4. Mise à jour des compteurs ───────────────────────────────
    usedIds.add(chosen.id);
    protCount[chosen.proteine_principale] =
      (protCount[chosen.proteine_principale] || 0) + 1;
    baseCount[chosen.base_cuisson || 'aucun'] =
      (baseCount[chosen.base_cuisson || 'aucun'] || 0) + 1;
    chosen.ingredients
      .slice(0, 3)
      .forEach((i) => (ingCount[i.ingredient] = (ingCount[i.ingredient] || 0) + 1));
    if (chosen.categorie === 'plaisir') plaisirCount++;
    if (chosen.categorie === 'familial') familialCount++;
    if (chosen.type_plat === 'soupe') soupCount++;
    if (
      chosen.proteine_principale === 'vegetarien' ||
      chosen.proteine_principale === 'legumineuse'
    )
      vegCount++;

    result.push(chosen);
  }

  // ── 5. Garantie végétarien/légumineuse au moins 1x par semaine ──
  if (vegCount === 0) {
    const vegCandidates = recipes.filter(
      (r) =>
        ['vegetarien', 'legumineuse'].includes(r.proteine_principale) &&
        (r.conservation === 'frigo' || r.conservation === 'les_deux')
    );
    if (vegCandidates.length > 0) {
      // Remplace mercredi (index 2) par un plat végétarien
      result[2] = vegCandidates[Math.floor(rng() * vegCandidates.length)];
    }
  }

  return result;
}

/* ─────────────────────────────────────────────
   EXPORTS GLOBAUX (compatibilité navigateur)
   ───────────────────────────────────────────── */
window.getISOWeek = getISOWeek;
window.generateWeekFromRecipes = generateWeekFromRecipes;
