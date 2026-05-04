/* ── Nav toggle ── */
const navToggle = document.querySelector(".nav-toggle");
const siteNav   = document.querySelector("#site-nav");

if (navToggle && siteNav) {
  const closeNav = () => {
    siteNav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Open navigation");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = siteNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  siteNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNav(); });
  window.addEventListener("resize",  ()  => { if (window.innerWidth > 900) closeNav(); });
}

/* ── Active nav link on scroll ── */
const sections = document.querySelectorAll("section[id], div[id]");
const navLinks  = Array.from(document.querySelectorAll(".nav-links a")).filter((link) => {
  try {
    const url = new URL(link.href, window.location.href);
    return url.pathname === window.location.pathname && url.hash;
  } catch {
    return false;
  }
});

if (sections.length && navLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          const url = new URL(link.href, window.location.href);
          link.style.color = url.hash === `#${entry.target.id}` ? "#1e3a5f" : "";
        });
      }
    });
  }, { threshold: 0.3 });

  sections.forEach((s) => observer.observe(s));
}

/* ── Contact form ── */
const contactForm = document.getElementById("contact-form");

if (contactForm) {
  const submitBtn  = contactForm.querySelector(".form-submit");
  const statusEl   = document.getElementById("form-status");
  const fileInput  = document.getElementById("attachment");
  const fileNameEl = document.getElementById("file-upload-name");

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      fileNameEl.textContent = fileInput.files[0].name;
      fileNameEl.classList.add("has-file");
    } else {
      fileNameEl.textContent = "PDF, Excel, or Image · Max 25 MB";
      fileNameEl.classList.remove("has-file");
    }
  });

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    submitBtn.disabled    = true;
    submitBtn.textContent = "Sending…";
    statusEl.className    = "form-status";
    statusEl.textContent  = "";

    try {
      // ⚠️  Replace YOUR_FORM_ID with your Formspree form ID.
      //     Sign up free at formspree.io → New Form → set recipient to joeybuk03@gmail.com
      const res = await fetch("https://formspree.io/f/YOUR_FORM_ID", {
        method:  "POST",
        body:    new FormData(contactForm),
        headers: { Accept: "application/json" },
      });

      if (res.ok) {
        submitBtn.textContent      = "Request Sent ✓";
        submitBtn.style.background = "#16a34a";
        statusEl.className         = "form-status form-status--success";
        statusEl.textContent       =
          "Your request was submitted. We’ll be in touch within one business day.";
        contactForm.reset();
        fileNameEl.textContent = "PDF, Excel, or Image · Max 25 MB";
        fileNameEl.classList.remove("has-file");
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed");
      }
    } catch {
      submitBtn.disabled    = false;
      submitBtn.textContent = "Submit Request →";
      statusEl.className    = "form-status form-status--error";
      statusEl.textContent  =
        "Something went wrong. Please email us directly at submissions@itemassist.com.";
    }
  });
}

/* Report preview detail rows */
function toggleReportDetail(id, el) {
  const row = document.getElementById(id);

  if (!row || !el) {
    return;
  }

  const isOpen = row.classList.toggle("open");
  el.classList.toggle("open", isOpen);

  const labelNode = Array.from(el.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
  );

  if (labelNode) {
    labelNode.textContent = isOpen ? "Hide Specs " : "View Specs ";
  }
}

window.toggleReportDetail = toggleReportDetail;
