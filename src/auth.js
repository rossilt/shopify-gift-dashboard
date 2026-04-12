const { DASHBOARD_USERNAME, DASHBOARD_PASSWORD } = require("./config");

function isAuthenticated(req) {
  return Boolean(req.session && req.session.isAuthenticated);
}

function attachCurrentUser(req, res, next) {
  if (isAuthenticated(req)) {
    res.locals.currentUser = {
      username: req.session.username || DASHBOARD_USERNAME,
    };
  } else {
    res.locals.currentUser = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  return res.redirect("/login");
}

function redirectIfAuthenticated(req, res, next) {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }

  next();
}

function verifyCredentials(username, password) {
  return (
    String(username || "").trim() === DASHBOARD_USERNAME &&
    String(password || "") === DASHBOARD_PASSWORD
  );
}

function loginUser(req) {
  req.session.isAuthenticated = true;
  req.session.username = DASHBOARD_USERNAME;
}

function logoutUser(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

module.exports = {
  attachCurrentUser,
  requireAuth,
  redirectIfAuthenticated,
  verifyCredentials,
  loginUser,
  logoutUser,
};