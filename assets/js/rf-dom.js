/*
 * DOM helpers for the ItemAssist workspace. Every string that came from the API is inserted with textContent (through `h`)
 * and is never parsed as markup. There is no matching, scoring or classification logic in any rf-*.js UI module.
 */
(function (root) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  /** Element builder. `text` and string children become text nodes; nothing is parsed as HTML. */
  function h(tag, props, children) {
    var node = document.createElement(tag);
    var options = props || {};
    if (options.class) node.className = options.class;
    if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
    if (options.attrs) {
      Object.keys(options.attrs).forEach(function (name) {
        if (options.attrs[name] !== null && options.attrs[name] !== undefined) node.setAttribute(name, String(options.attrs[name]));
      });
    }
    if (options.on) {
      Object.keys(options.on).forEach(function (name) { node.addEventListener(name, options.on[name]); });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function icon(name) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "rf-ic");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#rf-i-" + name);
    svg.appendChild(use);
    return svg;
  }

  function button(label, className, onClick) {
    return h("button", { class: className, text: label, attrs: { type: "button" }, on: { click: onClick } });
  }

  /** Headings that scripts move focus to carry tabindex -1 so they are focusable without joining the tab order. */
  function heading(tag, id, text, className) {
    return h(tag, { class: className || "", text: text, attrs: { id: id, tabindex: "-1" } });
  }

  /** Status pill: the label is always visible text; tone and icon only reinforce it. */
  function pill(tone, iconName, label, extraClass) {
    return h("span", { class: "rf-pill rf-pill--" + tone + (extraClass ? " " + extraClass : "") }, [iconName ? icon(iconName) : null, label]);
  }

  function emptyNote(title, message) {
    return h("div", { class: "rf-na" }, [h("p", { class: "rf-na-label", text: "Not available yet" }), h("p", { class: "rf-na-title", text: title }), message ? h("p", { text: message }) : null]);
  }

  function section(labelledBy, className, children) {
    return h("section", { class: className || "", attrs: { "aria-labelledby": labelledBy } }, children);
  }

  /**
   * Native disclosure for lower-priority detail on the single-page layout. The summary is the control (keyboard and screen reader
   * support come from <details>); `id` goes on it so scripts can open and focus it. `hint` is a one-line preview of what is inside.
   */
  function disclosure(options, children) {
    var summary = h("summary", { class: "rf-disc-sum", attrs: { id: options.id } }, [
      h("span", { class: "rf-disc-title", text: options.title }),
      options.count !== undefined && options.count !== null ? h("span", { class: "rf-disc-count", text: options.count }) : null,
      options.hint ? h("span", { class: "rf-disc-hint", text: options.hint }) : null
    ]);
    return h("details", { class: "rf-disc" + (options.className ? " " + options.className : ""), attrs: { open: options.open ? "" : null } }, [
      summary,
      h("div", { class: "rf-disc-body" }, children)
    ]);
  }

  root.RFDom = { h: h, icon: icon, button: button, heading: heading, pill: pill, emptyNote: emptyNote, section: section, disclosure: disclosure };
})(window);
