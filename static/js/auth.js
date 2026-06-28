/* CardioAI – Sign-In Page Logic */
(function () {
  "use strict";

  // ── If already authenticated, go straight to dashboard ──────────
  if (localStorage.getItem("cai_token")) {
    window.location.replace("/dashboard");
    return;
  }

  // ── DOM refs ─────────────────────────────────────────────────────
  var form = document.getElementById("signInForm");
  var emailEl = document.getElementById("emailInput");
  var passEl = document.getElementById("passwordInput");
  var errEl = document.getElementById("formError");
  var btnText = document.getElementById("btnText");
  var btnSpinner = document.getElementById("btnSpinner");
  var signInBtn = document.getElementById("signInBtn");
  var pwToggle = document.getElementById("pwToggle");
  var pwIcon = document.getElementById("pwToggleIcon");

  // ── Password visibility toggle ──────────────────────────────────
  pwToggle.addEventListener("click", function () {
    var isPass = passEl.type === "password";
    passEl.type = isPass ? "text" : "password";
    pwIcon.className = isPass ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
  });

  // ── Error helpers ────────────────────────────────────────────────
  function showError(msg) {
    errEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + msg;
    errEl.style.display = "flex";
  }
  function clearError() {
    errEl.style.display = "none";
    errEl.textContent = "";
  }

  // ── Loading state ────────────────────────────────────────────────
  function setLoading(on) {
    signInBtn.disabled = on;
    btnText.style.display = on ? "none" : "inline";
    btnSpinner.style.display = on ? "inline" : "none";
  }

  // ── Simple email validator ───────────────────────────────────────
  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  // ── Form submit ──────────────────────────────────────────────────
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearError();

    var email = emailEl.value.trim();
    var password = passEl.value;

    if (!email) {
      showError("Please enter your email address.");
      emailEl.focus();
      return;
    }
    if (!validEmail(email)) {
      showError("Please enter a valid email address.");
      emailEl.focus();
      return;
    }
    if (!password) {
      showError("Please enter your password.");
      passEl.focus();
      return;
    }

    setLoading(true);

    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          showError(result.data.error || "Sign-in failed. Please try again.");
          return;
        }
        localStorage.setItem("cai_token", result.data.token);
        localStorage.setItem("cai_name", result.data.name || "");
        window.location.replace("/dashboard");
      })
      .catch(function () {
        showError("Network error. Check your connection and try again.");
      })
      .finally(function () {
        setLoading(false);
      });
  });
})();
