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
      key: "webSearchProvider",
      select: elements.webSearchProvider,
      input: elements.webSearchProviderPickerInput,
      btn: elements.webSearchProviderPickerBtn,
      dropdown: elements.webSearchProviderPickerDropdown,
    },
    {
      key: "tavilySearchDepth",
      select: elements.tavilySearchDepth,
      input: elements.tavilySearchDepthPickerInput,
      btn: elements.tavilySearchDepthPickerBtn,
      dropdown: elements.tavilySearchDepthPickerDropdown,
    },
    {
      key: "exaSearchType",
      select: elements.exaSearchType,
      input: elements.exaSearchTypePickerInput,
      btn: elements.exaSearchTypePickerBtn,
      dropdown: elements.exaSearchTypePickerDropdown,
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

export function positionFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  const anchorEl = floatingDropdownAnchors.get(dropdownEl);
  if (!(anchorEl instanceof HTMLElement)) return;

  const rect = anchorEl.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 6;
  const configuredMinWidth = Math.max(
    220,
    parseInt(dropdownEl.dataset.floatingMinWidth || "", 10) || 220
  );
  const width = Math.min(
    Math.max(configuredMinWidth, Math.round(rect.width)),
    Math.max(220, window.innerWidth - viewportPadding * 2)
  );
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
  const maxHeight = Math.max(140, Math.min(320, Math.round(spaceBelow)));
  const alignMode = dropdownEl.dataset.floatingAlign || "start";
  const desiredLeft =
    alignMode === "center"
      ? Math.round(rect.left + rect.width / 2 - width / 2)
      : Math.round(rect.left);
  const left = Math.min(
    Math.max(viewportPadding, desiredLeft),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
  );
  const top = Math.round(rect.bottom + gap);

  dropdownEl.style.left = `${left}px`;
  dropdownEl.style.top = `${top}px`;
  dropdownEl.style.width = `${width}px`;
  dropdownEl.style.maxHeight = `${maxHeight}px`;
}

export function openFloatingDropdown(dropdownEl, anchorEl, options = {}) {
  if (!(dropdownEl instanceof HTMLElement) || !(anchorEl instanceof HTMLElement))
    return;
  rememberDropdownOrigin(dropdownEl);
  const host =
    options.host instanceof HTMLElement
      ? options.host
      : elements.configModal || document.body;
  if (dropdownEl.parentElement !== host) {
    host.appendChild(dropdownEl);
  }
  dropdownEl.classList.add("is-floating-dropdown");
  floatingDropdownAnchors.set(dropdownEl, anchorEl);
  positionFloatingDropdown(dropdownEl);
  dropdownEl.hidden = false;
  dropdownEl.setAttribute("aria-hidden", "false");
}

export function closeFloatingDropdown(dropdownEl) {
  if (!(dropdownEl instanceof HTMLElement)) return;
  dropdownEl.classList.remove("is-floating-dropdown");
  dropdownEl.style.left = "";
  dropdownEl.style.top = "";
  dropdownEl.style.width = "";
  dropdownEl.style.maxHeight = "";
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
  for (const dropdownEl of dropdowns) {
    if (!(dropdownEl instanceof HTMLElement)) continue;
    if (dropdownEl.hidden) continue;
    if (!dropdownEl.classList.contains("is-floating-dropdown")) continue;
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
