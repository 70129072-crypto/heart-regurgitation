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
  var storedName = localStorage.getItem("cai_name") || "";
  var nameEl = document.getElementById("userName");
  var avatarEl = document.getElementById("userAvatar");
  if (nameEl) nameEl.textContent = storedName;
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
        (a.overlay_image
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
          var rec = null;
          for (var k = 0; k < _lastAnalyses.length; k++) {
            if (_lastAnalyses[k].analysis_id === aid) {
              rec = _lastAnalyses[k];
              break;
            }
          }
          if (rec && rec.overlay_image) openLightbox(rec.overlay_image, aid);
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
      if (!selectedFile) {
        setModalError("Please select an MRI file.");
        return;
      }

      modalErrorBox.style.display = "none";
      analyzeBtnText.style.display = "none";
      analyzeBtnSpinner.style.display = "inline";
      modalAnalyzeBtn.disabled = true;

      var fd = new FormData();
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
})();
