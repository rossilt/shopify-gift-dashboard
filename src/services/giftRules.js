const DEFAULT_GIFT_RULES = [
  {
    tier: "50_60",
    label: "€50 to < €60",
    min: 50,
    maxExclusive: 60,
    skus: ["P0268S", "P0310S"],
  },
  {
    tier: "60_70",
    label: "€60 to < €70",
    min: 60,
    maxExclusive: 70,
    skus: ["P1527S"],
  },
  {
    tier: "70_100",
    label: "€70 to < €100",
    min: 70,
    maxExclusive: 100,
    skus: ["P0566S"],
  },
  {
    tier: "100_plus",
    label: "€100+",
    min: 100,
    maxExclusive: null,
    skus: ["P1988S"],
  },
];

function cloneGiftRules(rules = DEFAULT_GIFT_RULES) {
  return rules.map((rule) => ({
    tier: rule.tier,
    label: rule.label,
    min: Number(rule.min),
    maxExclusive: rule.maxExclusive == null ? null : Number(rule.maxExclusive),
    skus: [...new Set((rule.skus || []).map((sku) => String(sku).trim()).filter(Boolean))],
  }));
}

function normalizeGiftRules(rules) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return cloneGiftRules(DEFAULT_GIFT_RULES);
  }

  const fallbackByTier = Object.fromEntries(
    DEFAULT_GIFT_RULES.map((rule) => [rule.tier, rule])
  );

  return rules.map((rule) => {
    const fallback = fallbackByTier[rule.tier] || {};

    return {
      tier: rule.tier ?? fallback.tier,
      label: rule.label ?? fallback.label ?? "",
      min: Number(rule.min ?? fallback.min ?? 0),
      maxExclusive:
        rule.maxExclusive == null
          ? null
          : Number(rule.maxExclusive),
      skus: [
        ...new Set(
          (Array.isArray(rule.skus) ? rule.skus : fallback.skus || [])
            .map((sku) => String(sku).trim())
            .filter(Boolean)
        ),
      ],
    };
  });
}

function pickTier(subtotal, giftRules = DEFAULT_GIFT_RULES) {
  for (const rule of giftRules) {
    const max = rule.maxExclusive == null ? Infinity : Number(rule.maxExclusive);

    if (subtotal >= Number(rule.min) && subtotal < max) {
      return rule;
    }
  }

  return null;
}

module.exports = {
  DEFAULT_GIFT_RULES,
  cloneGiftRules,
  normalizeGiftRules,
  pickTier,
};