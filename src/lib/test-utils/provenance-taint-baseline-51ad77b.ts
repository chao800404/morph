/**
 * Frozen differential baseline: 51ad77b's B1 analysis over the shared
 * fixtures of `provenance-differential.ts`, produced once by running that
 * revision's `theme-content-provenance.ts` (see that module). Never
 * regenerate it from a newer revision.
 */
import type { DifferentialBaseline } from "./provenance-differential";

export const PROVENANCE_TAINT_BASELINE_51AD77B: DifferentialBaseline = {
  base: "51ad77b",
  start: {
    "bas:c1:content": {
      taints: [],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c1:loader": {
      taints: ["in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c2:content": {
      taints: ["in|content:hero.desc", "in|content:hero.title"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c2:loader": {
      taints: ["in|loader:hero.desc", "in|loader:hero.title", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c3:content": {
      taints: ["in|content:hero.desc", "in|content:hero.title"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c3:loader": {
      taints: ["in|loader:hero.desc", "in|loader:hero.title", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c4a:content": {
      taints: [],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c4a:loader": {
      taints: ["in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:c5:content": {
      taints: [],
      instances: [
        {
          name: "BasHero",
          claims: ["heroA.desc", "heroA.title"],
        },
        {
          name: "BasHero",
          claims: ["heroB.desc", "heroB.title"],
        },
      ],
    },
    "bas:c5:loader": {
      taints: ["in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["heroA.desc", "heroA.title"],
        },
        {
          name: "BasHero",
          claims: ["heroB.desc", "heroB.title"],
        },
      ],
    },
    "bas:c6a:content": {
      taints: ["in|content:promo.desc"],
      instances: [
        {
          name: "BasHero",
          claims: ["promo.desc"],
        },
        {
          name: "BasHero",
          claims: [],
        },
      ],
    },
    "bas:c6a:loader": {
      taints: ["in|loader:promo.desc", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["promo.desc"],
        },
        {
          name: "BasHero",
          claims: [],
        },
      ],
    },
    "bas:p1:content": {
      taints: ["in|content:hero.desc", "in|content:hero.title"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:p1:loader": {
      taints: ["in|loader:hero.desc", "in|loader:hero.title", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:p2:content": {
      taints: ["in|content:hero.desc"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "bas:p2:loader": {
      taints: ["in|loader:hero.desc", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "bas:p3:content": {
      taints: [],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "bas:p3:loader": {
      taints: ["in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "bas:p4a:content": {
      taints: [],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:p4a:loader": {
      taints: ["in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "bas:p5:content": {
      taints: [
        "in|content:heroA.desc",
        "in|content:heroA.title",
        "in|content:heroB.desc",
        "in|content:heroB.title",
      ],
      instances: [
        {
          name: "BasHero",
          claims: ["heroA.desc", "heroA.title"],
        },
        {
          name: "BasHero",
          claims: ["heroB.desc", "heroB.title"],
        },
      ],
    },
    "bas:p5:loader": {
      taints: [
        "in|loader:heroA.desc",
        "in|loader:heroA.title",
        "in|loader:heroB.desc",
        "in|loader:heroB.title",
        "in|page:",
      ],
      instances: [
        {
          name: "BasHero",
          claims: ["heroA.desc", "heroA.title"],
        },
        {
          name: "BasHero",
          claims: ["heroB.desc", "heroB.title"],
        },
      ],
    },
    "bas:p6:content": {
      taints: ["in|content:hero.desc", "in|content:hero.title"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "bas:p6:loader": {
      taints: ["in|loader:hero.desc", "in|loader:hero.title", "in|page:"],
      instances: [
        {
          name: "BasHero",
          claims: ["hero.desc"],
        },
      ],
    },
    "twin:A1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "twin:A2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "twin:A3": {
      taints: [
        "in|page:intro.desc",
        "in|page:intro.title",
        "in|page:team.desc",
        "in|page:team.title",
      ],
      instances: [
        {
          name: "Hero",
          claims: ["intro.desc", "intro.title"],
        },
        {
          name: "Hero",
          claims: ["team.desc", "team.title"],
        },
      ],
    },
    "twin:A4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:A5": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:A6": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "twin:N1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:N2": {
      taints: [],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "twin:N3": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "twin:N4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "twin:N5": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "twin:S1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "twin:S2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "twin:S3": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "twin:S4": {
      taints: ["page:*"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:S5": {
      taints: ["set|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:S7": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "twin:F2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:D1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:D2": {
      taints: ["set|page:length"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:R1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:R2": {
      taints: ["set|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "destructure:C1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:C2": {
      taints: ["set|page:x"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:A1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:A2": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:K1": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "destructure:X0a": {
      taints: [],
      instances: [
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "destructure:X0b": {
      taints: ["in|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.title"],
        },
      ],
    },
    "destructure:X1": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X1b": {
      taints: ["in|page:hero"],
      instances: [
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "destructure:X2": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X3": {
      taints: ["in|page:", "set|page:__proto__"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X3b": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X3c": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X5": {
      taints: ["in|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.title"],
        },
      ],
    },
  },
  astro: {
    "sample:A1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:A2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:A3": {
      taints: [
        "in|page:intro.desc",
        "in|page:intro.title",
        "in|page:team.desc",
        "in|page:team.title",
      ],
      instances: [
        {
          name: "Hero",
          claims: ["intro.desc", "intro.title"],
        },
        {
          name: "Hero",
          claims: ["team.desc", "team.title"],
        },
      ],
    },
    "sample:A4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:A5": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:A6": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "sample:N1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:N2": {
      taints: [],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "sample:N3": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:N4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:N5": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:S1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "sample:S2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "sample:S3": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "sample:S4": {
      taints: ["page:*"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:S5": {
      taints: ["set|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:S6": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:S6b": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:S7": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:F1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:F2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:F3": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:F4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "sample:F5": {
      taints: ["in|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.title"],
        },
      ],
    },
    "sample:F6": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:F7": {
      taints: [],
      instances: [
        {
          name: "Card",
          claims: [],
        },
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "sample:U1": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "sample:U2": {
      taints: ["in|page:card.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "sample:I1": {
      taints: [],
      instances: [
        {
          name: "Layout",
          claims: [],
        },
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "sample:I2": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
        {
          name: "Hero",
          claims: ["card.desc", "card.title"],
        },
      ],
    },
    "destructure:D1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:D2": {
      taints: ["set|page:length"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:R1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:R2": {
      taints: ["set|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "destructure:C1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:C2": {
      taints: ["set|page:x"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:A1": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:A2": {
      taints: ["set|page:title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:K1": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Hero",
          claims: [],
        },
      ],
    },
    "destructure:X0a": {
      taints: [],
      instances: [
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "destructure:X0b": {
      taints: ["in|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.title"],
        },
      ],
    },
    "destructure:X1": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X1b": {
      taints: ["in|page:hero"],
      instances: [
        {
          name: "Card",
          claims: ["card.title"],
        },
      ],
    },
    "destructure:X2": {
      taints: ["in|page:"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X3": {
      taints: ["in|page:", "set|page:__proto__"],
      instances: [
        {
          name: "Card",
          claims: [],
        },
      ],
    },
    "destructure:X3b": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X3c": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X4": {
      taints: [],
      instances: [
        {
          name: "Hero",
          claims: ["hero.desc", "hero.title"],
        },
      ],
    },
    "destructure:X5": {
      taints: ["in|page:hero.title"],
      instances: [
        {
          name: "Hero",
          claims: ["hero.title"],
        },
      ],
    },
  },
};
