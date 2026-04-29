const navToggle = document.querySelector(".nav-toggle");
const siteNav   = document.querySelector("#site-nav");
const formSubmit = document.querySelector(".form-submit");

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

  siteNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeNav);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeNav();
  });
}

const sections = document.querySelectorAll("section[id], div[id]");
const navLinks  = document.querySelectorAll(".nav-links a[href^='#']");

if (sections.length && navLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          link.style.color = link.getAttribute("href") === `#${entry.target.id}`
            ? "#1e3a5f"
            : "";
        });
      }
    });
  }, { threshold: 0.3 });

  sections.forEach((s) => observer.observe(s));
}

if (formSubmit) {
  formSubmit.addEventListener("click", () => {
    formSubmit.textContent = "Request Received ✓";
    formSubmit.style.background = "#16a34a";
    formSubmit.disabled = true;
  });
}
