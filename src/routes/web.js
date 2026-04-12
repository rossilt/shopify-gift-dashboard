const express = require("express");

const { TEST_ORDER_NUMBERS } = require("../config");
const { runGiftJob } = require("../services/giftEngine");
const runLogger = require("../services/runLogger");
const settingsStore = require("../services/settingsStore");
const {
  requireAuth,
  redirectIfAuthenticated,
  verifyCredentials,
  loginUser,
  logoutUser,
} = require("../auth");

const router = express.Router();

function parseOrderInput(raw) {
  if (!raw) return [];

  return [
    ...new Set(
      raw
        .split(",")
        .map((v) => v.trim().replace(/^#/, ""))
        .filter(Boolean)
    ),
  ];
}

function parseSkuList(raw) {
  return [
    ...new Set(
      String(raw || "")
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
}

function parseLimitInput(raw) {
  if (!raw || String(raw).trim() === "") return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Limit must be a positive number");
  }

  return parsed;
}

function parseSettings(body, currentSettings) {
  const scheduleHour = Number(body.scheduleHour);
  const scheduleMinute = Number(body.scheduleMinute);

  if (!Number.isInteger(scheduleHour) || scheduleHour < 0 || scheduleHour > 23) {
    throw new Error("Schedule hour must be between 0 and 23");
  }

  if (!Number.isInteger(scheduleMinute) || scheduleMinute < 0 || scheduleMinute > 59) {
    throw new Error("Schedule minute must be between 0 and 59");
  }

  const reasonText = String(body.reasonText || "").trim();
  const timezone = String(body.timezone || "").trim();

  if (!reasonText) {
    throw new Error("Reason text cannot be empty");
  }

  if (!timezone) {
    throw new Error("Timezone cannot be empty");
  }

  const nextGiftRules = currentSettings.giftRules.map((rule) => {
    const fieldName = `giftRule_${rule.tier}`;
    const skus = parseSkuList(body[fieldName]);

    if (skus.length === 0) {
      throw new Error(`Enter at least one SKU for ${rule.label}`);
    }

    return {
      ...rule,
      skus,
    };
  });

  return {
    reasonText,
    scheduleEnabled: body.scheduleEnabled === "on",
    scheduleHour,
    scheduleMinute,
    timezone,
    giftRules: nextGiftRules,
  };
}

async function renderDashboard(res, extra = {}) {
  const latestRun = await runLogger.getLatestRun();
  const settings = await settingsStore.getSettings();

  res.render("dashboard", {
    title: "Gift Mask Dashboard",
    latestRun,
    defaultOrderNumbers: TEST_ORDER_NUMBERS.join(","),
    giftRules: settings.giftRules,
    giftReason: settings.reasonText,
    settings,
    error: null,
    success: null,
    ...extra,
  });
}

router.get("/login", redirectIfAuthenticated, (req, res) => {
  res.render("login", {
    title: "Login",
    error: null,
  });
});

router.post("/login", redirectIfAuthenticated, (req, res) => {
  const username = req.body.username || "";
  const password = req.body.password || "";

  if (!verifyCredentials(username, password)) {
    return res.status(401).render("login", {
      title: "Login",
      error: "Invalid username or password",
    });
  }

  loginUser(req);

  req.session.save((error) => {
    if (error) {
      return res.status(500).render("login", {
        title: "Login",
        error: "Could not start session",
      });
    }

    return res.redirect("/");
  });
});

router.get("/logout", requireAuth, async (req, res) => {
  try {
    await logoutUser(req);
    res.clearCookie("connect.sid");
    return res.redirect("/login");
  } catch (error) {
    return res.status(500).send(`Logout failed: ${error.message}`);
  }
});

router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    await renderDashboard(res);
  } catch (error) {
    next(error);
  }
});

router.get("/settings", async (req, res, next) => {
  try {
    const settings = await settingsStore.getSettings();

    res.render("settings", {
      title: "Settings",
      settings,
      error: null,
      success: null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  try {
    const currentSettings = await settingsStore.getSettings();
    const patch = parseSettings(req.body, currentSettings);
    const settings = await settingsStore.updateSettings(patch);

    res.render("settings", {
      title: "Settings",
      settings,
      error: null,
      success: "Settings saved successfully.",
    });
  } catch (error) {
    try {
      const currentSettings = await settingsStore.getSettings();

      res.status(400).render("settings", {
        title: "Settings",
        settings: {
          ...currentSettings,
          reasonText: req.body.reasonText ?? currentSettings.reasonText,
          scheduleEnabled: req.body.scheduleEnabled === "on",
          scheduleHour: req.body.scheduleHour ?? currentSettings.scheduleHour,
          scheduleMinute: req.body.scheduleMinute ?? currentSettings.scheduleMinute,
          timezone: req.body.timezone ?? currentSettings.timezone,
          giftRules: currentSettings.giftRules.map((rule) => ({
            ...rule,
            skus: parseSkuList(req.body[`giftRule_${rule.tier}`] ?? rule.skus.join(", ")),
          })),
        },
        error: error.message,
        success: null,
      });
    } catch (innerError) {
      next(innerError);
    }
  }
});

router.get("/runs", async (req, res, next) => {
  try {
    const runHistory = await runLogger.listRuns(20);

    res.render("runs", {
      title: "Runs",
      runHistory,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/runs/:id", async (req, res, next) => {
  try {
    const entry = await runLogger.getRunById(req.params.id);

    if (!entry) {
      return res.status(404).send("Run not found");
    }

    res.render("run-detail", {
      title: "Run Detail",
      entry,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/run/dry/all", async (req, res) => {
  try {
    const limit = parseLimitInput(req.body.limit);
    const settings = await settingsStore.getSettings();

    const output = await runGiftJob({
      apply: false,
      allUnfulfilled: true,
      limit,
      reasonText: settings.reasonText,
      giftRules: settings.giftRules,
    });

    await runLogger.saveRun(output);

    await renderDashboard(res, {
      success: "Dry run for all unfulfilled orders completed successfully.",
    });
  } catch (error) {
    await renderDashboard(res, {
      error: error.message,
    });
  }
});

router.post("/run/apply/all", async (req, res) => {
  try {
    const limit = parseLimitInput(req.body.limit);
    const settings = await settingsStore.getSettings();

    const output = await runGiftJob({
      apply: true,
      allUnfulfilled: true,
      limit,
      reasonText: settings.reasonText,
      giftRules: settings.giftRules,
    });

    await runLogger.saveRun(output);

    await renderDashboard(res, {
      success: "Apply run for all unfulfilled orders completed successfully.",
    });
  } catch (error) {
    await renderDashboard(res, {
      error: error.message,
    });
  }
});

router.post("/run/dry/selected", async (req, res) => {
  try {
    const orderNumbers = parseOrderInput(req.body.orderNumbers);

    if (orderNumbers.length === 0) {
      throw new Error("Enter at least one order number");
    }

    const settings = await settingsStore.getSettings();

    const output = await runGiftJob({
      apply: false,
      allUnfulfilled: false,
      orderNumbers,
      reasonText: settings.reasonText,
      giftRules: settings.giftRules,
    });

    await runLogger.saveRun(output);

    await renderDashboard(res, {
      success: "Dry run for selected orders completed successfully.",
    });
  } catch (error) {
    await renderDashboard(res, {
      error: error.message,
    });
  }
});

router.post("/run/apply/selected", async (req, res) => {
  try {
    const orderNumbers = parseOrderInput(req.body.orderNumbers);

    if (orderNumbers.length === 0) {
      throw new Error("Enter at least one order number");
    }

    const settings = await settingsStore.getSettings();

    const output = await runGiftJob({
      apply: true,
      allUnfulfilled: false,
      orderNumbers,
      reasonText: settings.reasonText,
      giftRules: settings.giftRules,
    });

    await runLogger.saveRun(output);

    await renderDashboard(res, {
      success: "Apply run for selected orders completed successfully.",
    });
  } catch (error) {
    await renderDashboard(res, {
      error: error.message,
    });
  }
});

module.exports = router;