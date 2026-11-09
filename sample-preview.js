/* Homepage sample report preview: each item's "View Specs" button opens or closes its specification detail row.
   Without JavaScript every detail row stays open (the `js` class on <html> turns the hiding on). */
(() => {
  const root = document.getElementById("sample");
  if (!root) return;

  root.querySelectorAll(".item-link-btn").forEach((button) => {
    const row = document.getElementById(button.getAttribute("aria-controls"));
    if (!row) return;
    const label = button.firstChild;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      button.classList.toggle("open", open);
      row.classList.toggle("open", open);
      label.nodeValue = open ? "Hide Specs " : "View Specs ";
    });
  });
})();
