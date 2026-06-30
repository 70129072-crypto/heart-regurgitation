/* CardioAI – Dashboard Page Logic */
(function () {
  "use strict";

  // ── Auth guard ───────────────────────────────────────────────────
  var token = localStorage.getItem("cai_token");
  if (!token) {
    window.location.replace("/");
    return;
  }

  // ── DOM refs ─────────────────────────────────────────────────────
  var loadingZone = document.getElementById("loadingZone");
  var errorBanner = document.getElementById("errorBanner");
  var errorMsg = document.getElementById("errorBannerMsg");
  var statsGrid = document.getElementById("statsGrid");
  var tableSection = document.getElementById("tableSection");
  var analysesBody = document.getElementById("analysesBody");
  var recordCount = document.getElementById("recordCount");

  // ── Populate top-bar date ────────────────────────────────────────
  var dateEl = document.getElementById("currentDate");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  // ── Populate user info ───────────────────────────────────────────
  function abbreviateName(name, maxLen) {
    if (name.length <= maxLen) return name;
    var words = name.split(" ").filter(function (w) {
      return w.length > 0;
    });
    if (words.length <= 2) return name;
    var first = words[0];
    var last = words[words.length - 1];
    var midInitials = words
      .slice(1, words.length - 1)
      .map(function (w) {
        return w[0].toUpperCase() + ".";
      })
      .join(" ");
    return first + " " + midInitials + " " + last;
  }

  var storedName = localStorage.getItem("cai_name") || "";
  var nameEl = document.getElementById("userName");
  var avatarEl = document.getElementById("userAvatar");
  if (nameEl) {
    nameEl.title = storedName;
    nameEl.textContent = abbreviateName(storedName, 20);
  }
  if (avatarEl && storedName) {
    avatarEl.textContent = storedName
      .split(" ")
      .filter(function (w) {
        return w.length > 0;
      })
      .slice(0, 2)
      .map(function (w) {
        return w[0].toUpperCase();
      })
      .join("");
  }

  // ── Logout ───────────────────────────────────────────────────────
  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      localStorage.removeItem("cai_token");
      localStorage.removeItem("cai_name");
      window.location.replace("/");
    });
  }

  // ── Refresh button ───────────────────────────────────────────────
  var refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      loadDashboard();
    });
  }

  // ── Retry button ─────────────────────────────────────────────────
  var retryBtn = document.getElementById("retryBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", function () {
      loadDashboard();
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────
  var SEVERITY_BADGE = {
    Normal: "badge-normal",
    Mild: "badge-mild",
    Moderate: "badge-moderate",
    Severe: "badge-severe",
  };
  var EF_CLASS = {
    Normal: "ef-normal",
    Mild: "ef-mild",
    Moderate: "ef-moderate",
    Severe: "ef-severe",
  };
  var MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  function fmtDate(d) {
    if (!d) return "—";
    var parts = d.split("-");
    var month = MONTHS[parseInt(parts[1], 10) - 1] || "";
    return month + " " + parseInt(parts[2], 10) + ", " + parts[0];
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Render table rows ────────────────────────────────────────────
  function renderTable(analyses) {
    if (!analyses || analyses.length === 0) {
      analysesBody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-inbox" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "No analyses found.</td></tr>";
      return;
    }

    var html = "";
    for (var i = 0; i < analyses.length; i++) {
      var a = analyses[i];
      var badgeCls = SEVERITY_BADGE[a.severity] || "";
      var efCls = EF_CLASS[a.severity] || "";
      var statusCls =
        a.status === "Completed" ? "status-completed" : "status-processing";
      var fillPct = Math.min(Math.round(a.accuracy), 100);

      html +=
        "<tr>" +
        '<td><span class="id-chip">' +
        esc(a.analysis_id) +
        "</span></td>" +
        '<td><span class="pid-text">' +
        esc(a.patient_id) +
        "</span></td>" +
        "<td>" +
        fmtDate(a.analysis_date) +
        "</td>" +
        '<td><span class="ef-val ' +
        efCls +
        '">' +
        a.ejection_fraction.toFixed(1) +
        "%</span></td>" +
        '<td><span class="badge ' +
        badgeCls +
        '">' +
        esc(a.severity) +
        "</span></td>" +
        "<td>" +
        '<div class="accuracy-cell">' +
        '<span class="acc-val">' +
        a.accuracy.toFixed(1) +
        "%</span>" +
        '<div class="acc-bar-bg">' +
        '<div class="acc-bar-fill" style="width:' +
        fillPct +
        '%"></div>' +
        "</div>" +
        "</div>" +
        "</td>" +
        "<td>" +
        '<span class="status-chip ' +
        statusCls +
        '">' +
        '<span class="status-dot"></span>' +
        esc(a.status) +
        "</span>" +
        "</td>" +
        "<td>" +
        (a.has_overlay
          ? '<button class="btn-view-scan" data-aid="' +
            esc(a.analysis_id) +
            '" title="View MRI scan"><i class="fa-solid fa-eye"></i> View</button>'
          : '<span style="color:#94a3b8">&mdash;</span>') +
        "</td>" +
        "</tr>";
    }
    analysesBody.innerHTML = html;

    // Attach view-scan button listeners
    var viewBtns = analysesBody.querySelectorAll(".btn-view-scan");
    for (var j = 0; j < viewBtns.length; j++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var aid = btn.getAttribute("data-aid");
          fetch("/api/analysis/" + aid + "/image", {
            headers: { Authorization: "Bearer " + token },
          })
            .then(function (res) {
              return res.json();
            })
            .then(function (data) {
              if (data.overlay_image) openLightbox(data.overlay_image, aid);
            })
            .catch(function () {
              /* network error – silently ignore */
            });
        });
      })(viewBtns[j]);
    }
  }

  // ── Show / hide zones ─────────────────────────────────────────────
  function showLoading() {
    loadingZone.style.display = "flex";
    errorBanner.style.display = "none";
    statsGrid.style.display = "none";
    tableSection.style.display = "none";
  }
  function showError(msg) {
    loadingZone.style.display = "none";
    errorBanner.style.display = "flex";
    statsGrid.style.display = "none";
    tableSection.style.display = "none";
    errorMsg.textContent = msg || "Failed to load dashboard data.";
  }
  function showData() {
    loadingZone.style.display = "none";
    errorBanner.style.display = "none";
    statsGrid.style.display = "grid";
    tableSection.style.display = "block";
  }

  // ── Main data load ────────────────────────────────────────────────
  function loadDashboard() {
    showLoading();

    fetch("/api/dashboard", {
      headers: { Authorization: "Bearer " + token },
    })
      .then(function (res) {
        if (res.status === 401) {
          localStorage.removeItem("cai_token");
          localStorage.removeItem("cai_name");
          window.location.replace("/");
          return null;
        }
        if (!res.ok) throw new Error("Server responded with " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data) return;

        var s = data.stats;
        var d = s.severity_distribution || {};

        // Stats cards
        document.getElementById("statTotal").textContent = s.total_analyses;
        document.getElementById("statAccuracy").textContent =
          s.average_accuracy + "%";
        document.getElementById("statNormal").textContent =
          d.Normal !== undefined ? d.Normal : "—";
        document.getElementById("statSevere").textContent =
          d.Severe !== undefined ? d.Severe : "—";

        // Table
        _lastAnalyses = data.recent_analyses || [];
        renderTable(_lastAnalyses);
        var n = Array.isArray(data.recent_analyses)
          ? data.recent_analyses.length
          : 0;
        recordCount.textContent = n + " record" + (n !== 1 ? "s" : "");

        showData();
      })
      .catch(function (err) {
        console.error("Dashboard load error:", err);
        showError("Failed to load dashboard data. Please try again.");
      });
  }

  // ── Boot ──────────────────────────────────────────────────────────
  loadDashboard();

  var _lastAnalyses = [];

  // ══ NEW ANALYSIS MODAL ════════════════════════════════════════════

  var analysisModal = document.getElementById("analysisModal");
  var newAnalysisBtn = document.getElementById("newAnalysisBtn");
  var modalCloseBtn = document.getElementById("modalCloseBtn");
  var modalCancelBtn = document.getElementById("modalCancelBtn");
  var modalAnalyzeBtn = document.getElementById("modalAnalyzeBtn");
  var modalNewBtn = document.getElementById("modalNewBtn");
  var modalDoneBtn = document.getElementById("modalDoneBtn");
  var fileDropZone = document.getElementById("fileDropZone");
  var mriFileInput = document.getElementById("mriFileInput");
  var fileSelectedName = document.getElementById("fileSelectedName");
  var analyzeBtnText = document.getElementById("analyzeBtnText");
  var analyzeBtnSpinner = document.getElementById("analyzeBtnSpinner");
  var modalErrorBox = document.getElementById("modalError");
  var modalFormEl = document.getElementById("modalForm");
  var modalResultEl = document.getElementById("modalResult");
  var patientIdInput = document.getElementById("patientIdInput");

  var selectedFile = null;

  function openModal() {
    resetModal();
    analysisModal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    analysisModal.style.display = "none";
    document.body.style.overflow = "";
  }

  function resetModal() {
    selectedFile = null;
    if (patientIdInput) patientIdInput.value = "";
    fileSelectedName.style.display = "none";
    fileSelectedName.textContent = "";
    fileDropZone.classList.remove("has-file", "drag-over");
    modalErrorBox.style.display = "none";
    modalErrorBox.innerHTML = "";
    modalFormEl.style.display = "block";
    modalResultEl.style.display = "none";
    analyzeBtnText.style.display = "inline";
    analyzeBtnSpinner.style.display = "none";
    modalAnalyzeBtn.disabled = false;
  }

  function setModalError(msg) {
    modalErrorBox.innerHTML =
      '<i class="fa-solid fa-circle-exclamation"></i> ' + msg;
    modalErrorBox.style.display = "flex";
  }

  function setSelectedFile(file) {
    selectedFile = file;
    fileSelectedName.textContent =
      file.name + "  (" + (file.size / 1024).toFixed(1) + " KB)";
    fileSelectedName.style.display = "block";
    fileDropZone.classList.add("has-file");
  }

  // Open button
  if (newAnalysisBtn) {
    newAnalysisBtn.addEventListener("click", openModal);
  }

  // Close / cancel
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
  if (modalCancelBtn) modalCancelBtn.addEventListener("click", closeModal);

  // Close on backdrop click
  if (analysisModal) {
    analysisModal.addEventListener("click", function (e) {
      if (e.target === analysisModal) closeModal();
    });
  }

  // File drop-zone interactions
  if (fileDropZone) {
    fileDropZone.addEventListener("click", function () {
      mriFileInput.click();
    });
    fileDropZone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") mriFileInput.click();
    });
    fileDropZone.addEventListener("dragover", function (e) {
      e.preventDefault();
      fileDropZone.classList.add("drag-over");
    });
    fileDropZone.addEventListener("dragleave", function () {
      fileDropZone.classList.remove("drag-over");
    });
    fileDropZone.addEventListener("drop", function (e) {
      e.preventDefault();
      fileDropZone.classList.remove("drag-over");
      var f = e.dataTransfer.files[0];
      if (f) setSelectedFile(f);
    });
  }

  if (mriFileInput) {
    mriFileInput.addEventListener("change", function () {
      if (mriFileInput.files[0]) setSelectedFile(mriFileInput.files[0]);
    });
  }

  // Analyze button
  if (modalAnalyzeBtn) {
    modalAnalyzeBtn.addEventListener("click", function () {
      var patientId = patientIdInput ? patientIdInput.value.trim() : "";
      if (!patientId) {
        setModalError("Please enter a Patient ID.");
        if (patientIdInput) patientIdInput.focus();
        return;
      }
      if (!selectedFile) {
        setModalError("Please select an MRI file.");
        return;
      }

      modalErrorBox.style.display = "none";
      analyzeBtnText.style.display = "none";
      analyzeBtnSpinner.style.display = "inline";
      modalAnalyzeBtn.disabled = true;

      var fd = new FormData();
      fd.append("patient_id", patientId);
      fd.append("mri_file", selectedFile);

      fetch("/api/analyze", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            setModalError(
              result.data.error || "Analysis failed. Please try again.",
            );
            analyzeBtnText.style.display = "inline";
            analyzeBtnSpinner.style.display = "none";
            modalAnalyzeBtn.disabled = false;
            return;
          }
          showAnalysisResult(result.data);
          loadDashboard(); // refresh stats + table
        })
        .catch(function () {
          setModalError("Network error. Check your connection and try again.");
          analyzeBtnText.style.display = "inline";
          analyzeBtnSpinner.style.display = "none";
          modalAnalyzeBtn.disabled = false;
        });
    });
  }

  // Result panel
  function showAnalysisResult(data) {
    modalFormEl.style.display = "none";
    modalResultEl.style.display = "block";

    document.getElementById("resAnalysisId").textContent =
      data.analysis_id || "\u2014";
    document.getElementById("resPatientId").textContent =
      data.patient_id || "\u2014";
    document.getElementById("resEF").textContent =
      data.ejection_fraction !== undefined
        ? data.ejection_fraction.toFixed(1) + "%"
        : "\u2014";
    document.getElementById("resAccuracy").textContent =
      data.accuracy !== undefined ? data.accuracy.toFixed(1) + "%" : "\u2014";

    var sev = data.severity || "";
    var badgeCls = SEVERITY_BADGE[sev] || "";
    document.getElementById("resSeverityBadge").innerHTML =
      '<span class="badge ' + badgeCls + '">' + esc(sev) + "</span>";

    if (data.overlay_image) {
      document.getElementById("resultOverlayImg").src =
        "data:image/png;base64," + data.overlay_image;
    }
  }

  if (modalNewBtn) modalNewBtn.addEventListener("click", resetModal);
  if (modalDoneBtn) modalDoneBtn.addEventListener("click", closeModal);

  // ── Lightbox ───────────────────────────────────────────────────
  var imageLightbox = document.getElementById("imageLightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  var lightboxCaption = document.getElementById("lightboxCaption");
  var lightboxCloseBtn = document.getElementById("lightboxCloseBtn");

  function openLightbox(b64, analysisId) {
    lightboxImg.src = "data:image/png;base64," + b64;
    lightboxCaption.textContent = analysisId
      ? "Analysis " +
        analysisId +
        " \u2014 Original (left) \u00b7 Segmentation overlay (right)"
      : "Original (left) \u00b7 Segmentation overlay (right)";
    imageLightbox.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    imageLightbox.style.display = "none";
    document.body.style.overflow = "";
    lightboxImg.src = "";
  }

  if (lightboxCloseBtn)
    lightboxCloseBtn.addEventListener("click", closeLightbox);
  if (imageLightbox) {
    imageLightbox.addEventListener("click", function (e) {
      if (e.target === imageLightbox) closeLightbox();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (
      e.key === "Escape" &&
      imageLightbox &&
      imageLightbox.style.display === "flex"
    ) {
      closeLightbox();
    }
  });

  // ══════════════════════════════════════════════════════════════
  // VIEW NAVIGATION (SPA router)
  // ══════════════════════════════════════════════════════════════

  var VIEW_META = {
    overview: { el: "view-overview", bc: "Dashboard" },
    analyses: { el: "view-analyses", bc: "Analyses" },
    patients: { el: "view-patients", bc: "Patients" },
    reports: { el: "view-reports", bc: "Reports" },
    settings: { el: "view-settings", bc: "Settings" },
  };

  function switchView(viewName) {
    if (!VIEW_META[viewName]) return;
    // hide all views
    Object.keys(VIEW_META).forEach(function (k) {
      var el = document.getElementById(VIEW_META[k].el);
      if (el) el.style.display = "none";
    });
    // show target
    var target = document.getElementById(VIEW_META[viewName].el);
    if (target) target.style.display = "block";
    // breadcrumb
    var bc = document.getElementById("breadcrumbActive");
    if (bc) bc.textContent = VIEW_META[viewName].bc;
    // nav active state
    var navLinks = document.querySelectorAll(".nav-item[data-view]");
    for (var i = 0; i < navLinks.length; i++) {
      navLinks[i].classList.toggle(
        "active",
        navLinks[i].getAttribute("data-view") === viewName,
      );
    }
    // load data
    if (viewName === "analyses") loadAnalyses();
    else if (viewName === "patients") loadPatients();
    else if (viewName === "reports") loadReports();
    else if (viewName === "settings") initSettings();
  }

  // bind nav links
  (function () {
    var links = document.querySelectorAll(".nav-item[data-view]");
    for (var i = 0; i < links.length; i++) {
      (function (link) {
        link.addEventListener("click", function (e) {
          e.preventDefault();
          switchView(link.getAttribute("data-view"));
        });
      })(links[i]);
    }
  })();

  // shared helper: fetch overlay image and open lightbox
  function fetchAndShowImage(aid) {
    fetch("/api/analysis/" + aid + "/image", {
      headers: { Authorization: "Bearer " + token },
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (data.overlay_image) openLightbox(data.overlay_image, aid);
      })
      .catch(function () {});
  }

  // shared helper: render a standard analyses table body
  function renderAnalysesRows(tbody, analyses, colCount) {
    if (!tbody) return;
    if (!analyses || analyses.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="' +
        colCount +
        '" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-inbox" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "No analyses found.</td></tr>";
      return;
    }
    var html = "";
    for (var i = 0; i < analyses.length; i++) {
      var a = analyses[i];
      var badgeCls = SEVERITY_BADGE[a.severity] || "";
      var efCls = EF_CLASS[a.severity] || "";
      var statusCls =
        a.status === "Completed" ? "status-completed" : "status-processing";
      var fillPct = Math.min(Math.round(a.accuracy), 100);
      var scanCell = a.has_overlay
        ? '<button class="btn-view-scan" data-aid="' +
          esc(a.analysis_id) +
          '" title="View MRI scan"><i class="fa-solid fa-eye"></i> View</button>'
        : '<span style="color:#94a3b8">&mdash;</span>';

      if (colCount === 7) {
        // patient detail view – no Patient ID column
        html +=
          "<tr>" +
          '<td><span class="id-chip">' +
          esc(a.analysis_id) +
          "</span></td>" +
          "<td>" +
          fmtDate(a.analysis_date) +
          "</td>" +
          '<td><span class="ef-val ' +
          efCls +
          '">' +
          a.ejection_fraction.toFixed(1) +
          "%</span></td>" +
          '<td><span class="badge ' +
          badgeCls +
          '">' +
          esc(a.severity) +
          "</span></td>" +
          "<td><div class='accuracy-cell'><span class='acc-val'>" +
          a.accuracy.toFixed(1) +
          "%</span><div class='acc-bar-bg'><div class='acc-bar-fill' style='width:" +
          fillPct +
          "%'></div></div></div></td>" +
          '<td><span class="status-chip ' +
          statusCls +
          '"><span class="status-dot"></span>' +
          esc(a.status) +
          "</span></td>" +
          "<td>" +
          scanCell +
          "</td>" +
          "</tr>";
      } else {
        // 8-column view with Patient ID
        html +=
          "<tr>" +
          '<td><span class="id-chip">' +
          esc(a.analysis_id) +
          "</span></td>" +
          '<td><span class="pid-text">' +
          esc(a.patient_id) +
          "</span></td>" +
          "<td>" +
          fmtDate(a.analysis_date) +
          "</td>" +
          '<td><span class="ef-val ' +
          efCls +
          '">' +
          a.ejection_fraction.toFixed(1) +
          "%</span></td>" +
          '<td><span class="badge ' +
          badgeCls +
          '">' +
          esc(a.severity) +
          "</span></td>" +
          "<td><div class='accuracy-cell'><span class='acc-val'>" +
          a.accuracy.toFixed(1) +
          "%</span><div class='acc-bar-bg'><div class='acc-bar-fill' style='width:" +
          fillPct +
          "%'></div></div></div></td>" +
          '<td><span class="status-chip ' +
          statusCls +
          '"><span class="status-dot"></span>' +
          esc(a.status) +
          "</span></td>" +
          "<td>" +
          scanCell +
          "</td>" +
          "</tr>";
      }
    }
    tbody.innerHTML = html;
    var viewBtns = tbody.querySelectorAll(".btn-view-scan[data-aid]");
    for (var j = 0; j < viewBtns.length; j++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          fetchAndShowImage(btn.getAttribute("data-aid"));
        });
      })(viewBtns[j]);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ANALYSES VIEW
  // ══════════════════════════════════════════════════════════════

  var analysesFullBody = document.getElementById("analysesFullBody");
  var analysesRecordCount = document.getElementById("analysesRecordCount");
  var analysesSearchInput = document.getElementById("analysesSearchInput");
  var analysesSeverityFilter = document.getElementById(
    "analysesSeverityFilter",
  );
  var newAnalysisBtnAlt = document.getElementById("newAnalysisBtnAlt");

  if (newAnalysisBtnAlt) {
    newAnalysisBtnAlt.addEventListener("click", openModal);
  }

  function loadAnalyses() {
    var q = analysesSearchInput ? analysesSearchInput.value.trim() : "";
    var sev = analysesSeverityFilter ? analysesSeverityFilter.value : "";
    var url = "/api/analyses";
    var p = [];
    if (q) p.push("q=" + encodeURIComponent(q));
    if (sev) p.push("severity=" + encodeURIComponent(sev));
    if (p.length) url += "?" + p.join("&");

    if (analysesFullBody) {
      analysesFullBody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-spinner fa-spin" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "Loading\u2026</td></tr>";
    }

    fetch(url, { headers: { Authorization: "Bearer " + token } })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var list = data.analyses || [];
        if (analysesRecordCount) {
          analysesRecordCount.textContent =
            list.length + " record" + (list.length !== 1 ? "s" : "");
        }
        renderAnalysesRows(analysesFullBody, list, 8);
      })
      .catch(function () {
        if (analysesFullBody) {
          analysesFullBody.innerHTML =
            '<tr><td colspan="8" style="text-align:center;padding:36px;color:#ef4444;">' +
            "Failed to load analyses.</td></tr>";
        }
      });
  }

  var _analysesSearchTimer = null;
  if (analysesSearchInput) {
    analysesSearchInput.addEventListener("input", function () {
      clearTimeout(_analysesSearchTimer);
      _analysesSearchTimer = setTimeout(loadAnalyses, 300);
    });
  }
  if (analysesSeverityFilter) {
    analysesSeverityFilter.addEventListener("change", loadAnalyses);
  }

  // ══════════════════════════════════════════════════════════════
  // PATIENTS VIEW
  // ══════════════════════════════════════════════════════════════

  var patientsBody = document.getElementById("patientsBody");
  var patientsRecordCount = document.getElementById("patientsRecordCount");
  var patientsListSection = document.getElementById("patientsListSection");
  var patientDetailSection = document.getElementById("patientDetailSection");
  var patientDetailTitle = document.getElementById("patientDetailTitle");
  var patientDetailSub = document.getElementById("patientDetailSub");
  var patientAnalysesBody = document.getElementById("patientAnalysesBody");
  var patientBackBtn = document.getElementById("patientBackBtn");

  function loadPatients() {
    if (patientDetailSection) patientDetailSection.style.display = "none";
    if (patientsListSection) patientsListSection.style.display = "";

    if (patientsBody) {
      patientsBody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-spinner fa-spin" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "Loading\u2026</td></tr>";
    }

    fetch("/api/patients", { headers: { Authorization: "Bearer " + token } })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        var list = data.patients || [];
        if (patientsRecordCount) {
          patientsRecordCount.textContent =
            list.length + " patient" + (list.length !== 1 ? "s" : "");
        }
        renderPatientsTable(list);
      })
      .catch(function () {
        if (patientsBody) {
          patientsBody.innerHTML =
            '<tr><td colspan="6" style="text-align:center;padding:36px;color:#ef4444;">' +
            "Failed to load patients.</td></tr>";
        }
      });
  }

  function renderPatientsTable(patients) {
    if (!patientsBody) return;
    if (!patients || patients.length === 0) {
      patientsBody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-inbox" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "No patients found.</td></tr>";
      return;
    }
    var html = "";
    for (var i = 0; i < patients.length; i++) {
      var p = patients[i];
      var eCls = EF_CLASS[p.last_severity] || "";
      var bCls = SEVERITY_BADGE[p.last_severity] || "";
      html +=
        "<tr>" +
        '<td><span class="pid-text">' +
        esc(p.patient_id) +
        "</span></td>" +
        "<td>" +
        p.total_analyses +
        "</td>" +
        "<td>" +
        fmtDate(p.last_analysis_date) +
        "</td>" +
        '<td><span class="ef-val ' +
        eCls +
        '">' +
        (p.last_ef !== null && p.last_ef !== undefined
          ? parseFloat(p.last_ef).toFixed(1) + "%"
          : "\u2014") +
        "</span></td>" +
        '<td><span class="badge ' +
        bCls +
        '">' +
        esc(p.last_severity || "\u2014") +
        "</span></td>" +
        '<td><button class="btn-view-scan" data-pid="' +
        esc(p.patient_id) +
        '"><i class="fa-solid fa-folder-open"></i> View</button></td>' +
        "</tr>";
    }
    patientsBody.innerHTML = html;

    var btns = patientsBody.querySelectorAll(".btn-view-scan[data-pid]");
    for (var j = 0; j < btns.length; j++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          loadPatientDetail(btn.getAttribute("data-pid"));
        });
      })(btns[j]);
    }
  }

  function loadPatientDetail(pid) {
    if (patientsListSection) patientsListSection.style.display = "none";
    if (patientDetailSection) patientDetailSection.style.display = "";
    if (patientDetailTitle)
      patientDetailTitle.textContent = "Analyses for " + pid;
    if (patientDetailSub) patientDetailSub.textContent = pid;

    if (patientAnalysesBody) {
      patientAnalysesBody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:36px;color:#94a3b8;">' +
        '<i class="fa-solid fa-spinner fa-spin" style="font-size:22px;display:block;margin-bottom:8px;"></i>' +
        "Loading\u2026</td></tr>";
    }

    fetch("/api/patients/" + encodeURIComponent(pid) + "/analyses", {
      headers: { Authorization: "Bearer " + token },
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        renderAnalysesRows(patientAnalysesBody, data.analyses || [], 7);
      })
      .catch(function () {
        if (patientAnalysesBody) {
          patientAnalysesBody.innerHTML =
            '<tr><td colspan="7" style="text-align:center;padding:36px;color:#ef4444;">' +
            "Failed to load patient analyses.</td></tr>";
        }
      });
  }

  if (patientBackBtn) {
    patientBackBtn.addEventListener("click", function () {
      if (patientDetailSection) patientDetailSection.style.display = "none";
      if (patientsListSection) patientsListSection.style.display = "";
    });
  }

  // ══════════════════════════════════════════════════════════════
  // REPORTS VIEW
  // ══════════════════════════════════════════════════════════════

  var reportsStatsGrid = document.getElementById("reportsStatsGrid");
  var reportsSeveritySection = document.getElementById(
    "reportsSeveritySection",
  );
  var reportsTableSection = document.getElementById("reportsTableSection");
  var reportsBody = document.getElementById("reportsBody");
  var reportsRecordCount = document.getElementById("reportsRecordCount");
  var severityBarsWrap = document.getElementById("severityBarsWrap");
  var exportCsvBtn = document.getElementById("exportCsvBtn");
  var printReportBtn = document.getElementById("printReportBtn");

  function loadReports() {
    if (reportsStatsGrid) reportsStatsGrid.style.display = "none";
    if (reportsSeveritySection) reportsSeveritySection.style.display = "none";
    if (reportsTableSection) reportsTableSection.style.display = "none";

    fetch("/api/dashboard", { headers: { Authorization: "Bearer " + token } })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        renderReports(data);
      })
      .catch(function () {});
  }

  function renderReports(data) {
    var s = data.stats || {};
    var d = s.severity_distribution || {};
    var total = s.total_analyses || 0;

    // Stats cards (reuse the same markup pattern as overview)
    if (reportsStatsGrid) {
      reportsStatsGrid.innerHTML =
        '<div class="stat-card stat-card--blue">' +
        '<div class="stat-card-top"><div class="stat-card-icon"><i class="fa-solid fa-wave-square"></i></div>' +
        '<div class="stat-card-badge stat-card-badge--blue">All time</div></div>' +
        '<div class="stat-card-body"><p class="stat-card-label">Total Analyses</p>' +
        '<p class="stat-card-value">' +
        total +
        "</p></div>" +
        '<div class="stat-card-footer"><i class="fa-solid fa-arrow-trend-up stat-trend-icon"></i><span>Cumulative records</span></div>' +
        "</div>" +
        '<div class="stat-card stat-card--teal">' +
        '<div class="stat-card-top"><div class="stat-card-icon"><i class="fa-solid fa-bullseye"></i></div>' +
        '<div class="stat-card-badge stat-card-badge--teal">Model</div></div>' +
        '<div class="stat-card-body"><p class="stat-card-label">Average Accuracy</p>' +
        '<p class="stat-card-value">' +
        (s.average_accuracy || 0) +
        "%</p></div>" +
        '<div class="stat-card-footer"><i class="fa-solid fa-microchip stat-trend-icon"></i><span>Deep learning model</span></div>' +
        "</div>" +
        '<div class="stat-card stat-card--green">' +
        '<div class="stat-card-top"><div class="stat-card-icon"><i class="fa-solid fa-heart-circle-check"></i></div>' +
        '<div class="stat-card-badge stat-card-badge--green">EF \u2265 55%</div></div>' +
        '<div class="stat-card-body"><p class="stat-card-label">Normal Cases</p>' +
        '<p class="stat-card-value">' +
        (d.Normal || 0) +
        "</p></div>" +
        '<div class="stat-card-footer"><i class="fa-solid fa-circle-check stat-trend-icon"></i><span>Healthy ejection fraction</span></div>' +
        "</div>" +
        '<div class="stat-card stat-card--red">' +
        '<div class="stat-card-top"><div class="stat-card-icon"><i class="fa-solid fa-heart-crack"></i></div>' +
        '<div class="stat-card-badge stat-card-badge--red">EF &lt; 30%</div></div>' +
        '<div class="stat-card-body"><p class="stat-card-label">Severe Cases</p>' +
        '<p class="stat-card-value">' +
        (d.Severe || 0) +
        "</p></div>" +
        '<div class="stat-card-footer"><i class="fa-solid fa-triangle-exclamation stat-trend-icon"></i><span>Requires urgent review</span></div>' +
        "</div>";
      reportsStatsGrid.style.display = "grid";
    }

    // Severity distribution bars
    if (severityBarsWrap) {
      var sevs = [
        {
          label: "Normal",
          cls: "badge-normal",
          color: "#22c55e",
          count: d.Normal || 0,
        },
        {
          label: "Mild",
          cls: "badge-mild",
          color: "#f59e0b",
          count: d.Mild || 0,
        },
        {
          label: "Moderate",
          cls: "badge-moderate",
          color: "#f97316",
          count: d.Moderate || 0,
        },
        {
          label: "Severe",
          cls: "badge-severe",
          color: "#ef4444",
          count: d.Severe || 0,
        },
      ];
      var barsHtml = "";
      for (var i = 0; i < sevs.length; i++) {
        var sv = sevs[i];
        var pct = total > 0 ? Math.round((sv.count / total) * 100) : 0;
        barsHtml +=
          '<div class="sev-bar-row">' +
          '<div class="sev-bar-label"><span class="badge ' +
          sv.cls +
          '">' +
          sv.label +
          "</span></div>" +
          '<div class="sev-bar-track"><div class="sev-bar-fill" style="width:' +
          pct +
          "%;background:" +
          sv.color +
          '"></div></div>' +
          '<div class="sev-bar-count">' +
          sv.count +
          ' <span class="sev-bar-pct">(' +
          pct +
          "%)</span></div>" +
          "</div>";
      }
      severityBarsWrap.innerHTML = barsHtml;
      if (reportsSeveritySection) reportsSeveritySection.style.display = "";
    }

    // Analysis summary table
    var analyses = data.recent_analyses || [];
    if (reportsRecordCount) {
      reportsRecordCount.textContent =
        analyses.length + " record" + (analyses.length !== 1 ? "s" : "");
    }
    if (reportsBody) {
      if (!analyses.length) {
        reportsBody.innerHTML =
          '<tr><td colspan="7" style="text-align:center;padding:36px;color:#94a3b8;">' +
          '<i class="fa-solid fa-inbox" style="font-size:22px;display:block;margin-bottom:8px;"></i>No records.</td></tr>';
      } else {
        var rHtml = "";
        for (var j = 0; j < analyses.length; j++) {
          var a = analyses[j];
          var bCls = SEVERITY_BADGE[a.severity] || "";
          var eCls = EF_CLASS[a.severity] || "";
          var sCls =
            a.status === "Completed" ? "status-completed" : "status-processing";
          var fp = Math.min(Math.round(a.accuracy), 100);
          rHtml +=
            "<tr>" +
            '<td><span class="id-chip">' +
            esc(a.analysis_id) +
            "</span></td>" +
            '<td><span class="pid-text">' +
            esc(a.patient_id) +
            "</span></td>" +
            "<td>" +
            fmtDate(a.analysis_date) +
            "</td>" +
            '<td><span class="ef-val ' +
            eCls +
            '">' +
            a.ejection_fraction.toFixed(1) +
            "%</span></td>" +
            '<td><span class="badge ' +
            bCls +
            '">' +
            esc(a.severity) +
            "</span></td>" +
            "<td><div class='accuracy-cell'><span class='acc-val'>" +
            a.accuracy.toFixed(1) +
            "%</span><div class='acc-bar-bg'><div class='acc-bar-fill' style='width:" +
            fp +
            "%'></div></div></div></td>" +
            '<td><span class="status-chip ' +
            sCls +
            '"><span class="status-dot"></span>' +
            esc(a.status) +
            "</span></td>" +
            "</tr>";
        }
        reportsBody.innerHTML = rHtml;
      }
      if (reportsTableSection) reportsTableSection.style.display = "";
    }
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", function () {
      fetch("/api/export/csv", {
        headers: { Authorization: "Bearer " + token },
      })
        .then(function (res) {
          if (!res.ok) throw new Error("Export failed");
          return res.blob();
        })
        .then(function (blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "cardioai_analyses.csv";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        })
        .catch(function () {
          alert("Failed to export CSV. Please try again.");
        });
    });
  }

  if (printReportBtn) {
    printReportBtn.addEventListener("click", function () {
      window.print();
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SETTINGS VIEW
  // ══════════════════════════════════════════════════════════════

  var settingsNameInput = document.getElementById("settingsName");
  var settingsEmailInput = document.getElementById("settingsEmail");
  var saveProfileBtn = document.getElementById("saveProfileBtn");
  var profileSuccessMsg = document.getElementById("profileSuccessMsg");
  var profileErrorMsg = document.getElementById("profileErrorMsg");
  var settingsCurrentPw = document.getElementById("settingsCurrentPw");
  var settingsNewPw = document.getElementById("settingsNewPw");
  var settingsConfirmPw = document.getElementById("settingsConfirmPw");
  var savePasswordBtn = document.getElementById("savePasswordBtn");
  var passwordSuccessMsg = document.getElementById("passwordSuccessMsg");
  var passwordErrorMsg = document.getElementById("passwordErrorMsg");

  function initSettings() {
    var name = localStorage.getItem("cai_name") || "";
    var email = "";
    try {
      var parts = (token || "").split(".");
      if (parts.length === 3) {
        var payload = JSON.parse(atob(parts[1]));
        email = payload.email || "";
      }
    } catch (e) {}
    if (settingsNameInput) settingsNameInput.value = name;
    if (settingsEmailInput) settingsEmailInput.value = email;
    // clear messages and password fields
    [
      profileSuccessMsg,
      profileErrorMsg,
      passwordSuccessMsg,
      passwordErrorMsg,
    ].forEach(function (el) {
      if (el) {
        el.style.display = "none";
        el.textContent = "";
      }
    });
    [settingsCurrentPw, settingsNewPw, settingsConfirmPw].forEach(
      function (el) {
        if (el) el.value = "";
      },
    );
  }

  function showSettingsMsg(el, msg, isSuccess) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = "flex";
  }

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener("click", function () {
      var name = settingsNameInput ? settingsNameInput.value.trim() : "";
      if (!name) {
        showSettingsMsg(profileErrorMsg, "Please enter your full name.");
        if (settingsNameInput) settingsNameInput.focus();
        return;
      }
      if (name.length < 2 || name.length > 50) {
        showSettingsMsg(
          profileErrorMsg,
          "Name must be between 2 and 50 characters long.",
        );
        if (settingsNameInput) settingsNameInput.focus();
        return;
      }
      if (!/^[a-zA-Z\s\-'.,]{2,50}$/.test(name)) {
        showSettingsMsg(
          profileErrorMsg,
          "Name contains invalid characters. Only letters, spaces, hyphens, apostrophes, and periods are allowed.",
        );
        if (settingsNameInput) settingsNameInput.focus();
        return;
      }
      saveProfileBtn.disabled = true;
      saveProfileBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Saving\u2026';

      fetch("/api/settings/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ name: name }),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (result) {
          saveProfileBtn.disabled = false;
          saveProfileBtn.innerHTML =
            '<i class="fa-solid fa-floppy-disk"></i>&nbsp;Save Changes';
          if (result.ok) {
            localStorage.setItem("cai_name", result.d.name);
            var nameEl = document.getElementById("userName");
            var avatarEl = document.getElementById("userAvatar");
            if (nameEl) {
              nameEl.title = result.d.name;
              nameEl.textContent = abbreviateName(result.d.name, 20);
            }
            if (avatarEl) {
              avatarEl.textContent = result.d.name
                .split(" ")
                .filter(function (w) {
                  return w.length > 0;
                })
                .slice(0, 2)
                .map(function (w) {
                  return w[0].toUpperCase();
                })
                .join("");
            }
            if (profileErrorMsg) profileErrorMsg.style.display = "none";
            showSettingsMsg(
              profileSuccessMsg,
              "\u2713 Profile updated successfully.",
              true,
            );
          } else {
            if (profileSuccessMsg) profileSuccessMsg.style.display = "none";
            showSettingsMsg(
              profileErrorMsg,
              result.d.error || "Failed to update profile.",
            );
          }
        })
        .catch(function () {
          saveProfileBtn.disabled = false;
          saveProfileBtn.innerHTML =
            '<i class="fa-solid fa-floppy-disk"></i>&nbsp;Save Changes';
          showSettingsMsg(profileErrorMsg, "Network error. Please try again.");
        });
    });
  }

  if (savePasswordBtn) {
    savePasswordBtn.addEventListener("click", function () {
      var current = settingsCurrentPw ? settingsCurrentPw.value : "";
      var newPw = settingsNewPw ? settingsNewPw.value : "";
      var confirm = settingsConfirmPw ? settingsConfirmPw.value : "";

      if (!current || !newPw || !confirm) {
        showSettingsMsg(
          passwordErrorMsg,
          "Please fill in all password fields.",
        );
        return;
      }
      if (newPw.length < 8 || !/[A-Za-z]/.test(newPw) || !/[0-9]/.test(newPw)) {
        showSettingsMsg(
          passwordErrorMsg,
          "Password must be at least 8 characters and include both letters and numbers.",
        );
        if (settingsNewPw) settingsNewPw.focus();
        return;
      }
      if (newPw !== confirm) {
        showSettingsMsg(passwordErrorMsg, "Passwords do not match.");
        if (settingsConfirmPw) settingsConfirmPw.focus();
        return;
      }
      savePasswordBtn.disabled = true;
      savePasswordBtn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;Updating\u2026';

      fetch("/api/settings/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({
          current_password: current,
          new_password: newPw,
        }),
      })
        .then(function (res) {
          return res.json().then(function (d) {
            return { ok: res.ok, d: d };
          });
        })
        .then(function (result) {
          savePasswordBtn.disabled = false;
          savePasswordBtn.innerHTML =
            '<i class="fa-solid fa-key"></i>&nbsp;Update Password';
          if (result.ok) {
            if (passwordErrorMsg) passwordErrorMsg.style.display = "none";
            showSettingsMsg(
              passwordSuccessMsg,
              "\u2713 Password updated successfully.",
              true,
            );
            [settingsCurrentPw, settingsNewPw, settingsConfirmPw].forEach(
              function (el) {
                if (el) el.value = "";
              },
            );
          } else {
            if (passwordSuccessMsg) passwordSuccessMsg.style.display = "none";
            showSettingsMsg(
              passwordErrorMsg,
              result.d.error || "Failed to update password.",
            );
          }
        })
        .catch(function () {
          savePasswordBtn.disabled = false;
          savePasswordBtn.innerHTML =
            '<i class="fa-solid fa-key"></i>&nbsp;Update Password';
          showSettingsMsg(passwordErrorMsg, "Network error. Please try again.");
        });
    });
  }
})();
