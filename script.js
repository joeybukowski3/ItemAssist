const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector("#site-nav");
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
    link.addEventListener("click", () => {
      closeNav();
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeNav();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) {
      closeNav();
    }
  });
}

const sections = document.querySelectorAll("section[id], div[id]");
const navLinks = document.querySelectorAll(".nav-links a[href^='#']");

if (sections.length && navLinks.length) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navLinks.forEach((link) => {
          link.style.color = link.getAttribute("href") === `#${entry.target.id}`
            ? "rgba(255,255,255,0.95)"
            : "";
        });
      }
    });
  }, { threshold: 0.3 });

  sections.forEach((section) => observer.observe(section));
}

if (formSubmit) {
  formSubmit.addEventListener("click", () => {
    formSubmit.textContent = "Request Received \u2713";
    formSubmit.style.background = "#1A7A4C";
    formSubmit.disabled = true;
  });
}
