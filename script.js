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

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    submitBtn.disabled    = false;
    submitBtn.textContent = "Submit Request →";
    statusEl.className    = "form-status";
    statusEl.className    = "form-status form-status--error";
    statusEl.textContent  =
      "Online submission is not connected yet. Please email your request to submissions@itemassist.com and we’ll follow up with the best way to send any attachments.";
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
  el.setAttribute("aria-expanded", String(isOpen));

  const labelNode = Array.from(el.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
  );

  if (labelNode) {
    labelNode.textContent = isOpen ? "Hide Specs " : "View Specs ";
  }
}

window.toggleReportDetail = toggleReportDetail;

const publishedDateEls = document.querySelectorAll(".report-published-date");

if (publishedDateEls.length) {
  const today = new Date();
  const options = { year: "numeric", month: "long", day: "numeric" };
  const formatted = `Published ${today.toLocaleDateString("en-US", options)}`;

  publishedDateEls.forEach((el) => {
    el.textContent = formatted;
  });
}
