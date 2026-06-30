/* CardioAI – Auth Page Logic (Sign-In + Sign-Up) */
(function () {
  "use strict";

  // ── If already authenticated, go straight to dashboard ──────────
  if (localStorage.getItem("cai_token")) {
    window.location.replace("/dashboard");
    return;
  }

  // ── DOM refs – Sign-In ───────────────────────────────────────────
  var signInForm = document.getElementById("signInForm");
  var emailEl = document.getElementById("emailInput");
  var passEl = document.getElementById("passwordInput");
  var errEl = document.getElementById("formError");
  var btnText = document.getElementById("btnText");
  var btnSpinner = document.getElementById("btnSpinner");
  var signInBtn = document.getElementById("signInBtn");
  var pwToggle = document.getElementById("pwToggle");
  var pwIcon = document.getElementById("pwToggleIcon");

  // ── DOM refs – Sign-Up ───────────────────────────────────────────
  var signUpForm = document.getElementById("signUpForm");
  var suNameEl = document.getElementById("suNameInput");
  var suEmailEl = document.getElementById("suEmailInput");
  var suPassEl = document.getElementById("suPasswordInput");
  var suConfirmEl = document.getElementById("suConfirmInput");
  var suErrEl = document.getElementById("suFormError");
  var suBtnText = document.getElementById("suBtnText");
  var suBtnSpinner = document.getElementById("suBtnSpinner");
  var signUpBtn = document.getElementById("signUpBtn");
  var suPwToggle = document.getElementById("suPwToggle");
  var suPwIcon = document.getElementById("suPwToggleIcon");
  var suConfToggle = document.getElementById("suConfirmToggle");
  var suConfIcon = document.getElementById("suConfirmToggleIcon");

  // ── Toggle links ─────────────────────────────────────────────────
  var goToSignup = document.getElementById("goToSignup");
  var goToSignIn = document.getElementById("goToSignIn");
  var formTitle = document.getElementById("formTitle");
  var formSub = document.getElementById("formSub");

  goToSignup.addEventListener("click", function () {
    signInForm.style.display = "none";
    signUpForm.style.display = "block";
    formTitle.textContent = "Create an account";
    formSub.textContent = "Join CardioAI – it only takes a moment";
    clearError();
    clearSuError();
  });

  goToSignIn.addEventListener("click", function () {
    signUpForm.style.display = "none";
    signInForm.style.display = "block";
    formTitle.textContent = "Welcome back";
    formSub.textContent = "Sign in to your CardioAI account";
    clearError();
    clearSuError();
  });

  // ── Password visibility toggles ──────────────────────────────────
  pwToggle.addEventListener("click", function () {
    var isPass = passEl.type === "password";
    passEl.type = isPass ? "text" : "password";
    pwIcon.className = isPass ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
  });

  suPwToggle.addEventListener("click", function () {
    var isPass = suPassEl.type === "password";
    suPassEl.type = isPass ? "text" : "password";
    suPwIcon.className = isPass
      ? "fa-regular fa-eye-slash"
      : "fa-regular fa-eye";
  });

  suConfToggle.addEventListener("click", function () {
    var isPass = suConfirmEl.type === "password";
    suConfirmEl.type = isPass ? "text" : "password";
    suConfIcon.className = isPass
      ? "fa-regular fa-eye-slash"
      : "fa-regular fa-eye";
  });

  // ── Error helpers – Sign-In ──────────────────────────────────────
  function showError(msg) {
    errEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + msg;
    errEl.style.display = "flex";
  }
  function clearError() {
    errEl.style.display = "none";
    errEl.textContent = "";
  }

  // ── Error helpers – Sign-Up ──────────────────────────────────────
  function showSuError(msg) {
    suErrEl.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + msg;
    suErrEl.style.display = "flex";
  }
  function clearSuError() {
    suErrEl.style.display = "none";
    suErrEl.textContent = "";
  }

  // ── Loading helpers ──────────────────────────────────────────────
  function setLoading(on) {
    signInBtn.disabled = on;
    btnText.style.display = on ? "none" : "inline";
    btnSpinner.style.display = on ? "inline" : "none";
  }
  function setSuLoading(on) {
    signUpBtn.disabled = on;
    suBtnText.style.display = on ? "none" : "inline";
    suBtnSpinner.style.display = on ? "inline" : "none";
  }

  // ── Validators ───────────────────────────────────────────────────
  function validEmail(v) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    return emailRegex.test(v);
  }

  function validName(v) {
    const nameRegex = /^[a-zA-Z\s\-'.,]{2,50}$/;
    return nameRegex.test(v);
  }

  function validPassword(v) {
    // At least 8 characters, must contain a letter and a digit
    return v.length >= 8 && /[A-Za-z]/.test(v) && /[0-9]/.test(v);
  }

  // ── Sign-In submit ───────────────────────────────────────────────
  signInForm.addEventListener("submit", function (e) {
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
          return { ok: res.ok, data: data };
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

  // ── Sign-Up submit ───────────────────────────────────────────────
  signUpForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearSuError();

    var name = suNameEl.value.trim();
    var email = suEmailEl.value.trim();
    var password = suPassEl.value;
    var confirm = suConfirmEl.value;

    if (!name) {
      showSuError("Please enter your full name.");
      suNameEl.focus();
      return;
    }
    if (name.length < 2 || name.length > 50) {
      showSuError("Name must be between 2 and 50 characters long.");
      suNameEl.focus();
      return;
    }

    if (!validName(name)) {
      showSuError(
        "Name contains invalid characters. Only letters, spaces, hyphens, apostrophes, and periods are allowed.",
      );
      suNameEl.focus();
      return;
    }

    if (!email) {
      showSuError("Please enter your email address.");
      suEmailEl.focus();
      return;
    }
    if (!validEmail(email)) {
      showSuError("Please enter a valid email address.");
      suEmailEl.focus();
      return;
    }
    if (!password) {
      showSuError("Please enter a password.");
      suPassEl.focus();
      return;
    }
    if (!validPassword(password)) {
      showSuError(
        "Password must be at least 8 characters and include both letters and numbers.",
      );
      suPassEl.focus();
      return;
    }
    if (password !== confirm) {
      showSuError("Passwords do not match.");
      suConfirmEl.focus();
      return;
    }

    setSuLoading(true);

    fetch("/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, email: email, password: password }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          showSuError(result.data.error || "Sign-up failed. Please try again.");
          return;
        }
        localStorage.setItem("cai_token", result.data.token);
        localStorage.setItem("cai_name", result.data.name || "");
        window.location.replace("/dashboard");
      })
      .catch(function () {
        showSuError("Network error. Check your connection and try again.");
      })
      .finally(function () {
        setSuLoading(false);
      });
  });
})();
