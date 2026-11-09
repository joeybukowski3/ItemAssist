/* Homepage research showcase: accessible Televisions / Refrigerators tabs and a per-case "full comparison" disclosure.
   Without JavaScript both cases and their full tables stay visible (the `js` class on <html> turns the hiding on). */
(() => {
  const root = document.getElementById("research-showcase");
  if (!root) return;

  const tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));

  const select = (index, moveFocus) => {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[i].classList.toggle("is-active", active);
    });
    if (moveFocus) tabs[index].focus();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = i === last ? 0 : i + 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = i === 0 ? last : i - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    });
  });

  root.querySelectorAll(".sc-toggle").forEach((button) => {
    const region = document.getElementById(button.getAttribute("aria-controls"));
    if (!region) return;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      region.classList.toggle("is-open", open);
      button.textContent = open ? "Hide full specification comparison" : "Show full specification comparison";
    });
  });
})();
