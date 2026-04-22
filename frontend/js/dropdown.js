import { elements, floatingDropdownOrigins, floatingDropdownAnchors } from './state.js';

// Late-bound to avoid circular dependency
let _closeModelDropdown = () => {};
export function setCloseModelDropdown(fn) { _closeModelDropdown = fn; }

const PRESS_START_EVENT =
  typeof window !== "undefined" && "PointerEvent" in window
    ? "pointerdown"
    : "mousedown";

export function getConfigSelectPickerDefs() {
  return [
    {
      key: "provider",
      select: elements.provider,
      input: elements.providerPickerInput,
      btn: elements.providerPickerBtn,
      dropdown: elements.providerPickerDropdown,
    },
    {
      key: "builtinWebSearch",
      select: elements.builtinWebSearch,
      input: elements.builtinWebSearchPickerInput,
      btn: elements.builtinWebSearchPickerBtn,
      dropdown: elements.builtinWebSearchPickerDropdown,
    },
    {
      key: "webSearchProvider",
      select: elements.webSearchProvider,
      input: elements.webSearchProviderPickerInput,
      btn: elements.webSearchProviderPickerBtn,
      dropdown: elements.webSearchProviderPickerDropdown,
    },
    {
      key: "webSearchMode",
      select: elements.webSearchMode,
      input: elements.webSearchModePickerInput,
      btn: elements.webSearchModePickerBtn,
      dropdown: elements.webSearchModePickerDropdown,
    },
  ];
}

export function getConfigSelectPickerDef(key) {
  return getConfigSelectPickerDefs().find((item) => item.key === key) || null;
}

export function getSelectOptionLabel(selectEl, value) {
  if (!selectEl) return "";
  const options = Array.from(selectEl.options || []);
  const found = options.find((opt) => opt.value === value);
  return (found?.textContent || value || "").trim();
}

export function rememberDropdownOrigin(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  if (floatingDropdownOrigins.has(dropdownEl)) return;
  floatingDropdownOrigins.set(dropdownEl, {
    parent: dropdownEl.parentElement,
    next: dropdownEl.nextSibling,
  });
}

export function restoreDropdownOrigin(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const origin = floatingDropdownOrigins.get(dropdownEl);
  if (!origin?.parent) return;
  if (dropdownEl.parentElement === origin.parent) return;
  if (origin.next && origin.next.parentNode === origin.parent) {
    origin.parent.insertBefore(dropdownEl, origin.next);
  } else {
    origin.parent.appendChild(dropdownEl);
  }
}

export function mountBodyDropdown(dropdownEl, options = {}) {
  if (!(dropdownEl instanceof HTMLElement) || typeof document === "undefined") {
    return;
  }
  const openClass = String(options.openClass || "is-floating-open");
  const host = options.host instanceof HTMLElement ? options.host : document.body;
  rememberDropdownOrigin(dropdownEl);
  if (dropdownEl.parentElement !== host) {
    host.appendChild(dropdownEl);
  }
  if (openClass) {
    dropdownEl.classList.add(openClass);
  }
}

export function unmountBodyDropdown(dropdownEl, options = {}) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const openClass = String(options.openClass || "is-floating-open");
  if (openClass) {
    dropdownEl.classList.remove(openClass);
  }
  restoreDropdownOrigin(dropdownEl);
}

export function clearBodyDropdownPosition(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  dropdownEl.style.position = "";
  dropdownEl.style.left = "";
  dropdownEl.style.top = "";
  dropdownEl.style.right = "";
  dropdownEl.style.bottom = "";
  dropdownEl.style.width = "";
  dropdownEl.style.minWidth = "";
  dropdownEl.style.maxWidth = "";
  dropdownEl.style.maxHeight = "";
}

export function positionBodyDropdown(dropdownEl, anchorEl, options = {}) {
  if (!(dropdownEl instanceof HTMLElement) || !(anchorEl instanceof HTMLElement)) {
    return null;
  }

  const viewportPadding = Math.max(
    0,
    Number.isFinite(options.viewportPadding) ? Number(options.viewportPadding) : 12
  );
  const gap = Math.max(0, Number.isFinite(options.gap) ? Number(options.gap) : 8);
  const minWidth = Math.max(
    0,
    Number.isFinite(options.minWidth) ? Number(options.minWidth) : 0
  );
  const minViewportWidth = Math.max(
    minWidth,
    Number.isFinite(options.minViewportWidth)
      ? Number(options.minViewportWidth)
      : minWidth
  );
  const align = String(options.align || "start").toLowerCase();

  const rect = anchorEl.getBoundingClientRect();
  const maxWidth = Math.max(minViewportWidth, window.innerWidth - viewportPadding * 2);

  dropdownEl.style.position = "fixed";
  dropdownEl.style.left = "0px";
  dropdownEl.style.top = "0px";
  dropdownEl.style.right = "auto";
  dropdownEl.style.bottom = "auto";
  dropdownEl.style.width = "";
  dropdownEl.style.minWidth = `${Math.max(minWidth, Math.round(rect.width))}px`;
  dropdownEl.style.maxWidth = `${maxWidth}px`;

  const width = Math.min(
    Math.max(dropdownEl.offsetWidth, Math.round(rect.width), minWidth),
    maxWidth
  );
  const height = dropdownEl.offsetHeight;

  let desiredLeft = rect.left;
  if (align === "center") {
    desiredLeft = rect.left + rect.width / 2 - width / 2;
  } else if (align === "end" || align === "right") {
    desiredLeft = rect.right - width;
  }

  const left = Math.min(
    Math.max(viewportPadding, Math.round(desiredLeft)),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
  );

  let top = Math.round(rect.top - gap - height);
  if (top < viewportPadding) {
    top = Math.round(
      Math.min(
        window.innerHeight - viewportPadding - height,
        rect.bottom + gap
      )
    );
  }

  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.top = `${top}px`;
  dropdownEl.style.width = `${width}px`;

  return { left, top, width, height };
}

export function positionFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const anchorEl = floatingDropdownAnchors.get(dropdownEl);
  if (!(anchorEl instanceof HTMLElement)) return;

  const rect = anchorEl.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 6;
  const isNarrowViewport = window.innerWidth <= 720;
  const isHeaderModelDropdown = dropdownEl.id === "headerModelDropdown";
  const configuredMinWidth = Math.max(
    220,
    parseInt(dropdownEl.dataset.floatingMinWidth || "", 10) || 220
  );
  const maxAvailableWidth = Math.max(220, window.innerWidth - viewportPadding * 2);
  const width =
    isNarrowViewport && isHeaderModelDropdown
      ? Math.min(maxAvailableWidth, Math.max(260, Math.round(window.innerWidth - 20)))
      : Math.min(
          Math.max(configuredMinWidth, Math.round(rect.width)),
          maxAvailableWidth
        );

  // Use visualViewport for accurate mobile measurements (avoids browser-chrome inflation of window.innerHeight)
  const vvp = typeof window !== "undefined" ? window.visualViewport : null;
  const vpHeight = Math.round(vvp ? vvp.height : window.innerHeight);
  const vpOffsetTop = Math.round(vvp ? vvp.offsetTop : 0);
  const vpTop = vpOffsetTop + viewportPadding;
  const vpBottom = vpOffsetTop + vpHeight - viewportPadding;

  const spaceBelow = vpOffsetTop + vpHeight - rect.bottom - viewportPadding - gap;
  const spaceAbove = rect.top - vpOffsetTop - viewportPadding - gap;
  const placementPref = dropdownEl.dataset.floatingPlacement || "";
  const preferTop =
    placementPref === "top" ||
    (placementPref !== "bottom" && spaceBelow < 200 && spaceAbove > spaceBelow);
  const availableSpace = preferTop ? spaceAbove : spaceBelow;
  const maxHeight =
    isNarrowViewport && isHeaderModelDropdown
      ? Math.max(120, Math.min(420, Math.round(Math.max(spaceAbove, spaceBelow))))
      : Math.max(140, Math.min(320, Math.round(availableSpace)));
  const alignMode = dropdownEl.dataset.floatingAlign || "start";
  const desiredLeft =
    alignMode === "center"
      ? Math.round(rect.left + rect.width / 2 - width / 2)
      : Math.round(rect.left);
  const left = Math.min(
    Math.max(viewportPadding, desiredLeft),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
  );
  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.width = `${width}px`;
  dropdownEl.style.maxHeight = `${maxHeight}px`;
  dropdownEl.style.minHeight = "";

  let top;
  if (preferTop) {
    const height = Math.min(dropdownEl.offsetHeight || 0, maxHeight);
    top = Math.round(rect.top - gap - height);
    // If dropdown would go above viewport, try placing below the anchor instead
    if (top < vpTop) {
      const topBelow = Math.round(rect.bottom + gap);
      if (topBelow + height <= vpBottom) {
        top = topBelow;
      } else {
        top = Math.max(vpTop, top);
      }
    }
  } else {
    const height = Math.min(dropdownEl.offsetHeight || 0, maxHeight);
    top = Math.round(rect.bottom + gap);
    // If dropdown would go below viewport, try placing above the anchor instead
    if (top + height > vpBottom) {
      const topAbove = Math.round(rect.top - gap - height);
      if (topAbove >= vpTop) {
        top = topAbove;
      } else {
        top = Math.max(vpTop, Math.min(vpBottom - height, top));
      }
    }
  }
  dropdownEl.style.top = `${top}px`;
}

export function openFloatingDropdown(dropdownEl, anchorEl, options = {}) {
  if (!(dropdownEl instanceof HTMLElement) || !(anchorEl instanceof HTMLElement))
    return;
  rememberDropdownOrigin(dropdownEl);
  const host =
    options.host instanceof HTMLElement
      ? options.host
      : document.body;
  if (dropdownEl.parentElement !== host) {
    host.appendChild(dropdownEl);
  }
  dropdownEl.classList.add("is-floating-dropdown");
  floatingDropdownAnchors.set(dropdownEl, anchorEl);
  dropdownEl.hidden = false;
  dropdownEl.setAttribute("aria-hidden", "false");
  positionFloatingDropdown(dropdownEl);
}

export function closeFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  dropdownEl.classList.remove("is-floating-dropdown");
  dropdownEl.style.left = "";
  dropdownEl.style.top = "";
  dropdownEl.style.width = "";
  dropdownEl.style.maxHeight = "";
  dropdownEl.style.minHeight = "";
  floatingDropdownAnchors.delete(dropdownEl);
  restoreDropdownOrigin(dropdownEl);
}

export function repositionOpenFloatingDropdowns() {
  const dropdowns = [
    elements.modelDropdown,
    elements.modelDropdownTitle,
    elements.headerModelDropdown,
    ...getConfigSelectPickerDefs().map((item) => item.dropdown),
  ];
  const activeEl = document.activeElement;
  for (const dropdownEl of dropdowns) {
    if (!(dropdownEl instanceof HTMLElement)) continue;
    if (dropdownEl.hidden) continue;
    if (!dropdownEl.classList.contains("is-floating-dropdown")) continue;
    // Skip repositioning when user is typing in a search input inside this dropdown.
    // Keyboard open/close fires resize events; repositioning while the input is focused
    // disrupts focus, collapses the keyboard, and causes a bounce loop.
    if (activeEl instanceof HTMLElement && activeEl.tagName === "INPUT" && dropdownEl.contains(activeEl)) continue;
    positionFloatingDropdown(dropdownEl);
  }
}

export function syncConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select || !picker?.input) return;
  picker.input.value = getSelectOptionLabel(picker.select, picker.select.value);
}

export function syncAllConfigSelectPickers() {
  const defs = getConfigSelectPickerDefs();
  for (const picker of defs) {
    syncConfigSelectPicker(picker.key);
  }
}

export function setConfigSelectPickerButtonState(key, isOpen) {
  const picker = getConfigSelectPickerDef(key);
  const btn = picker?.btn;
  if (!btn) return;
  btn.classList.toggle("open", !!isOpen);
  btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

export function isConfigSelectPickerOpen(key) {
  const picker = getConfigSelectPickerDef(key);
  return !!picker?.dropdown && !picker.dropdown.hidden;
}

export function closeConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown) return;
  picker.dropdown.hidden = true;
  picker.dropdown.setAttribute("aria-hidden", "true");
  picker.dropdown.innerHTML = "";
  closeFloatingDropdown(picker.dropdown);
  setConfigSelectPickerButtonState(key, false);
}

export function closeAllConfigSelectPickers(exceptKey = "") {
  for (const picker of getConfigSelectPickerDefs()) {
    if (picker.key === exceptKey) continue;
    closeConfigSelectPicker(picker.key);
  }
}

export function applyConfigSelectPickerValue(key, value) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select) return;
  const nextValue = String(value || "");
  if (picker.select.value !== nextValue) {
    picker.select.value = nextValue;
    picker.select.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    syncConfigSelectPicker(key);
  }
  closeConfigSelectPicker(key);
}

export function renderConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown || !picker?.select) return;
  const options = Array.from(picker.select.options || []);

  picker.dropdown.innerHTML = "";
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = "暂无可选项";
    picker.dropdown.appendChild(empty);
    return;
  }

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "model-dropdown-item";
    if (opt.disabled) {
      btn.classList.add("is-disabled");
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    }
    btn.dataset.value = opt.value;
    btn.textContent = (opt.textContent || opt.value || "").trim();
    btn.addEventListener(PRESS_START_EVENT, (e) => e.preventDefault());
    if (!opt.disabled) {
      btn.addEventListener("click", () =>
        applyConfigSelectPickerValue(key, opt.value)
      );
    }
    picker.dropdown.appendChild(btn);
  }
}

export function openConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.dropdown || !picker?.input) return;
  _closeModelDropdown("main");
  closeAllConfigSelectPickers(key);
  renderConfigSelectPicker(key);
  const anchorEl = picker.input.closest?.(".model-picker-row") || picker.input;
  openFloatingDropdown(picker.dropdown, anchorEl);
  setConfigSelectPickerButtonState(key, true);
}

export function toggleConfigSelectPicker(key) {
  if (isConfigSelectPickerOpen(key)) {
    closeConfigSelectPicker(key);
    return;
  }
  openConfigSelectPicker(key);
}

export function bindConfigSelectPicker(key) {
  const picker = getConfigSelectPickerDef(key);
  if (!picker?.select || !picker?.input || !picker?.btn || !picker?.dropdown) {
    return;
  }

  if (!picker.btn.dataset.bound) {
    picker.btn.addEventListener("click", () => toggleConfigSelectPicker(key));
    picker.btn.dataset.bound = "1";
  }

  if (!picker.input.dataset.bound) {
    picker.input.addEventListener("click", () => toggleConfigSelectPicker(key));
    picker.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleConfigSelectPicker(key);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeConfigSelectPicker(key);
      }
    });
    picker.input.dataset.bound = "1";
  }

  if (!picker.select.dataset.pickerBound) {
    picker.select.addEventListener("change", () => {
      syncConfigSelectPicker(key);
      closeConfigSelectPicker(key);
    });
    picker.select.dataset.pickerBound = "1";
  }

  syncConfigSelectPicker(key);
}

export function initConfigSelectPickers() {
  for (const picker of getConfigSelectPickerDefs()) {
    bindConfigSelectPicker(picker.key);
  }
}
