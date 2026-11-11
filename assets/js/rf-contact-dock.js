/*
 * On narrow screens the research composer is pinned to the bottom of the viewport. It would sit on top of the contact form, so the page
 * marks itself (`rf-contact-active`) and the stylesheet slides the composer away, in exactly two cases:
 *   - the visitor is using the contact form (focus is inside #contact), or
 *   - no part of the research workspace is on screen any more (only the contact section and footer are).
 * While any of the workspace is visible, and the contact form is not in use, the composer is always there: it is the primary control.
 * Without IntersectionObserver only the focus rule applies, and the composer otherwise stays where it is.
 */
(function () {
  "use strict";

  var shell = document.getElementById("rf-shell");
  var contact = document.getElementById("contact");
  if (!shell || !contact) return;

  var workspaceVisible = true;
  var contactInUse = false;

  function update() {
    document.body.classList.toggle("rf-contact-active", contactInUse || !workspaceVisible);
  }

  contact.addEventListener("focusin", function () { contactInUse = true; update(); });
  contact.addEventListener("focusout", function (event) {
    // Moving between fields inside the form is still "in use".
    if (event.relatedTarget && contact.contains(event.relatedTarget)) return;
    contactInUse = false;
    update();
  });

  if (typeof window.IntersectionObserver === "function") {
    new window.IntersectionObserver(function (entries) {
      workspaceVisible = entries[entries.length - 1].isIntersecting;
      update();
    }, { threshold: 0 }).observe(shell);
  }
})();
