/* Reusable state and navigation helpers for handdrawn execution-flow diagrams. */
(function (global) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const roundedSelectControllers = new WeakMap();
  const markerPrefixes = new WeakMap();
  let markerLayerSequence = 0;
  const DEFAULT_MARKER_COLORS = {
    default: "#524b42",
    data: "#2563eb",
    reduce: "#c2410c",
    broadcast: "#047857"
  };

  function createCleanup() {
    const tasks = [];
    return {
      listen(target, type, handler, options) {
        if (!target?.addEventListener) return handler;
        target.addEventListener(type, handler, options);
        tasks.push(() => target.removeEventListener(type, handler, options));
        return handler;
      },
      add(task) {
        if (typeof task === "function") tasks.push(task);
      },
      destroy() {
        tasks.splice(0).reverse().forEach(task => task());
      }
    };
  }

  function closestWithin(target, selector, root) {
    if (!(target instanceof Element)) return null;
    const element = target.closest(selector);
    return element && (element === root || root?.contains(element)) ? element : null;
  }

  function createSvgLayer(options, className) {
    const root = options.root;
    const host = options.host || root?.parentElement;
    if (!(root instanceof SVGElement) || !host) return null;
    const layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add(className);
    layer.setAttribute("aria-hidden", "true");
    host.append(layer);
    return layer;
  }

  function markerPrefixFor(svg) {
    const existing = markerPrefixes.get(svg);
    if (existing) return existing;
    const ownerDocument = svg.ownerDocument || document;
    let prefix;
    do {
      markerLayerSequence += 1;
      prefix = `flow-marker-${markerLayerSequence}`;
    } while (ownerDocument.querySelector(`[id^="${prefix}-"]`));
    markerPrefixes.set(svg, prefix);
    svg.dataset.flowMarkerPrefix = prefix;
    return prefix;
  }

  function markerId(prefix, name, active = false) {
    const token = Array.from(String(name || "default"), character => character.codePointAt(0).toString(16)).join("-");
    return `${prefix}-${active ? "active" : "normal"}-${token}`;
  }

  function createScrollIndicator(options) {
    const viewport = options.viewport;
    const container = options.container;
    if (!viewport || !container) return { update() {}, destroy() {} };

    const vertical = options.axis === "vertical";
    const scrollPosition = vertical ? "scrollTop" : "scrollLeft";
    const scrollExtent = vertical ? "scrollHeight" : "scrollWidth";
    const clientExtent = vertical ? "clientHeight" : "clientWidth";
    const pointerPosition = vertical ? "clientY" : "clientX";
    const rectStart = vertical ? "top" : "left";
    const sizeProperty = vertical ? "height" : "width";
    const transform = vertical ? "translateY" : "translateX";
    const cleanup = createCleanup();
    const classTargets = Array.from(new Set((options.classTargets || []).filter(Boolean)));
    const originalClassStates = new Map(classTargets.map(target => [target, target.classList.contains(options.visibleClass)]));
    const indicator = document.createElement("div");
    indicator.className = options.railClass;
    const thumb = document.createElement("div");
    thumb.className = options.thumbClass;
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "slider");
    thumb.setAttribute("aria-label", options.thumbLabel);
    thumb.setAttribute("aria-valuemin", "0");
    thumb.setAttribute("aria-valuemax", "100");
    indicator.append(thumb);
    container.append(indicator);

    let frame = 0;
    let activePointer = null;
    let grabOffset = 0;
    let destroyed = false;

    function metrics() {
      const range = Math.max(0, viewport[scrollExtent] - viewport[clientExtent]);
      const inset = options.inset || 3;
      const available = Math.max(0, indicator[clientExtent] - inset * 2);
      const proportional = viewport[scrollExtent]
        ? available * (viewport[clientExtent] / viewport[scrollExtent])
        : available;
      const size = Math.min(available, Math.max(options.minThumb, proportional));
      return { range, inset, size, travel: Math.max(0, available - size) };
    }

    function endDrag() {
      if (activePointer !== null && thumb.hasPointerCapture?.(activePointer)) thumb.releasePointerCapture(activePointer);
      activePointer = null;
      thumb.classList.remove("is-dragging");
    }

    function update() {
      frame = 0;
      if (destroyed) return;
      const current = metrics();
      const visible = current.range > 1;
      indicator.hidden = !visible;
      classTargets.forEach(target => target.classList.toggle(options.visibleClass, visible));
      thumb.toggleAttribute("aria-disabled", !visible);
      if (!visible) {
        thumb.setAttribute("aria-valuenow", "0");
        endDrag();
        return;
      }
      const ratio = current.range ? viewport[scrollPosition] / current.range : 0;
      thumb.style[sizeProperty] = `${current.size}px`;
      thumb.style.transform = `${transform}(${current.inset + ratio * current.travel}px)`;
      thumb.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    }

    function scheduleUpdate() {
      if (!destroyed && !frame) frame = global.requestAnimationFrame(update);
    }

    function setFromPointer(event) {
      const current = metrics();
      const rect = indicator.getBoundingClientRect();
      const position = Math.max(
        current.inset,
        Math.min(current.inset + current.travel, event[pointerPosition] - rect[rectStart] - grabOffset)
      );
      viewport[scrollPosition] = current.travel
        ? ((position - current.inset) / current.travel) * current.range
        : 0;
      scheduleUpdate();
    }

    cleanup.listen(thumb, "pointerdown", event => {
      if (event.button !== undefined && event.button !== 0) return;
      const current = metrics();
      const rect = indicator.getBoundingClientRect();
      const ratio = current.range ? viewport[scrollPosition] / current.range : 0;
      activePointer = event.pointerId;
      grabOffset = event[pointerPosition] - rect[rectStart] - (current.inset + ratio * current.travel);
      thumb.setPointerCapture?.(event.pointerId);
      thumb.classList.add("is-dragging");
      event.preventDefault();
      event.stopPropagation();
    });
    cleanup.listen(thumb, "pointermove", event => {
      if (event.pointerId === activePointer) setFromPointer(event);
    });
    cleanup.listen(thumb, "pointerup", event => {
      if (event.pointerId === activePointer) endDrag();
    });
    cleanup.listen(thumb, "pointercancel", endDrag);
    cleanup.listen(thumb, "lostpointercapture", endDrag);
    cleanup.listen(thumb, "keydown", event => {
      const backward = vertical ? "ArrowUp" : "ArrowLeft";
      const forward = vertical ? "ArrowDown" : "ArrowRight";
      if (event.key === backward || event.key === forward) {
        event.preventDefault();
        const amount = (event.key === backward ? -1 : 1) * options.keyboardStep;
        viewport.scrollBy({ [vertical ? "top" : "left"]: amount, behavior: "smooth" });
      }
      if (event.key === "Home") { event.preventDefault(); viewport[scrollPosition] = 0; }
      if (event.key === "End") { event.preventDefault(); viewport[scrollPosition] = viewport[scrollExtent]; }
    });
    cleanup.listen(viewport, "scroll", scheduleUpdate, { passive: true });

    const resizeObserver = global.ResizeObserver ? new ResizeObserver(scheduleUpdate) : null;
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(indicator);
    const mutationObserver = options.observeMutations ? new MutationObserver(records => {
      if (records.some(record => record.target !== indicator && !indicator.contains(record.target))) scheduleUpdate();
    }) : null;
    mutationObserver?.observe(viewport, { childList: true, subtree: true, characterData: true, attributes: true });
    update();

    return {
      indicator,
      thumb,
      update,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        endDrag();
        cleanup.destroy();
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        if (frame) global.cancelAnimationFrame(frame);
        classTargets.forEach(target => target.classList.toggle(options.visibleClass, originalClassStates.get(target)));
        indicator.remove();
      }
    };
  }

  /** Create a compact draggable vertical rail for a scrollable list. */
  function createVerticalScrollRail(options) {
    const viewport = options.viewport;
    const container = options.container || viewport?.parentElement;
    return createScrollIndicator({
      viewport,
      container,
      axis: "vertical",
      railClass: "flow-vertical-scroll-rail",
      thumbClass: "flow-vertical-scroll-thumb",
      thumbLabel: options.thumbLabel || "Vertical scroll position",
      visibleClass: "has-scroll-indicator",
      classTargets: [container],
      minThumb: 24,
      keyboardStep: 48,
      observeMutations: true
    });
  }

  /** Add a compact draggable horizontal rail to a native scrolling text/table viewport. */
  function createHorizontalScrollRail(options) {
    const viewport = options.viewport;
    if (!viewport) return { update() {}, destroy() {} };
    let host = options.host;
    let ownsHost = false;
    const originalParent = viewport.parentElement;
    const originalNext = viewport.nextSibling;
    if (!host) {
      if (originalParent?.classList.contains("flow-horizontal-scroll-host")) host = originalParent;
      else {
        host = document.createElement("div");
        host.className = "flow-horizontal-scroll-host";
        viewport.before(host);
        host.append(viewport);
        ownsHost = true;
      }
    }
    if (!host) return { update() {}, destroy() {} };
    const hadHostClass = host.classList.contains("flow-horizontal-scroll-host");
    host.classList.add("flow-horizontal-scroll-host");
    const controller = createScrollIndicator({
      viewport,
      container: host,
      axis: "horizontal",
      railClass: "flow-horizontal-scroll-rail",
      thumbClass: "flow-horizontal-scroll-thumb",
      thumbLabel: options.thumbLabel || "Horizontal scroll position",
      visibleClass: "has-horizontal-scroll-indicator",
      classTargets: [viewport, host],
      minThumb: 30,
      keyboardStep: 72,
      observeMutations: true
    });
    let destroyed = false;
    return {
      ...controller,
      host,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        controller.destroy();
        if (!hadHostClass) host.classList.remove("flow-horizontal-scroll-host");
        if (!ownsHost) return;
        const insertionPoint = originalNext?.parentNode === originalParent ? originalNext : null;
        originalParent?.insertBefore(viewport, insertionPoint);
        host.remove();
      }
    };
  }

  /** Re-measure HTML endpoint geometry after a viewport or container resize. */
  function bindLayoutRefresh(options) {
    const root = options.root;
    const refresh = options.refresh;
    if (!root || typeof refresh !== "function") return { destroy() {} };
    const cleanup = createCleanup();
    let frame = 0;
    let destroyed = false;
    function update() {
      frame = 0;
      if (!destroyed) refresh();
    }
    function schedule() {
      if (destroyed || frame) return;
      frame = global.requestAnimationFrame(() => {
        if (destroyed) { frame = 0; return; }
        frame = global.requestAnimationFrame(update);
      });
    }
    cleanup.listen(global, "resize", schedule, { passive: true });
    cleanup.listen(global.visualViewport, "resize", schedule, { passive: true });
    cleanup.listen(document.fonts, "loadingdone", schedule);
    document.fonts?.ready.then(() => { if (!destroyed) schedule(); });
    const targets = Array.from(new Set([root].concat(options.observe || []).filter(Boolean)));
    const resizeObserver = global.ResizeObserver ? new ResizeObserver(schedule) : null;
    targets.forEach(target => resizeObserver?.observe(target));
    const mutationObserver = global.MutationObserver ? new MutationObserver(records => {
      const htmlChanged = records.some(record => {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return !target || target.namespaceURI !== SVG_NS;
      });
      if (htmlChanged) schedule();
    }) : null;
    targets.forEach(target => mutationObserver?.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "style"]
    }));
    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        cleanup.destroy();
        resizeObserver?.disconnect();
        mutationObserver?.disconnect();
        if (frame) global.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
  }

  /**
   * Reserve the largest natural block size across a component's declared states.
   * The caller renders semantic state into an off-screen clone; the component
   * consumes the measured maximum through its own CSS variable.
   */
  function createStableStateLayout(options) {
    const target = options.target;
    const render = options.render;
    if (!target || typeof render !== "function") {
      return { setStates() {}, setActive() {}, refresh() {}, capture() {}, flush() {}, getMetrics() {}, destroy() {} };
    }

    const property = "--flow-stable-block-size";
    const currentProperty = "--flow-stable-current-block-size";
    const contentEndProperty = "--flow-stable-content-end";
    const slackProperty = "--flow-stable-slack";
    const requestedProbeRoot = options.probeRoot || target.parentElement || document.body;
    const probeRoot = requestedProbeRoot === target || target.contains(requestedProbeRoot)
      ? (target.parentElement || document.body)
      : requestedProbeRoot;
    let states = Array.from(options.states || []);
    let stateBlockSizes = [];
    let activeIndex = Math.max(0, Number(options.activeIndex) || 0);
    let measuredInlineSize = -1;
    let reservedBlockSize = 0;
    let activeBlockSize = 0;
    let activeSlack = 0;
    let measureFrame = 0;
    let captureFrame = 0;
    let destroyed = false;
    const cleanup = createCleanup();
    const springEnabled = options.slackVisual === "spring";
    const spring = springEnabled ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : null;
    const ownsSpringPosition = springEnabled && getComputedStyle(target).position === "static";

    target.setAttribute("data-flow-stable-layout", "");
    if (spring) {
      spring.setAttribute("class", "flow-layout-spring");
      spring.setAttribute("viewBox", "0 0 16 32");
      spring.setAttribute("preserveAspectRatio", "none");
      spring.setAttribute("focusable", "false");
      spring.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M3 1 H13 M8 1 V4 L2 8 L14 13 L2 18 L14 23 L8 28 V31 M3 31 H13");
      spring.append(path);
      target.setAttribute("data-flow-stable-spring", "");
      if (ownsSpringPosition) target.classList.add("flow-layout-spring-host");
      target.append(spring);
    }

    function ensureSpring() {
      if (spring && spring.parentElement !== target) target.append(spring);
    }

    function cancelMeasureFrame() {
      if (measureFrame) global.cancelAnimationFrame(measureFrame);
      measureFrame = 0;
    }

    function cancelCaptureFrame() {
      if (captureFrame) global.cancelAnimationFrame(captureFrame);
      captureFrame = 0;
    }

    function applyBlockSize(value) {
      if (!(value > 0)) {
        reservedBlockSize = 0;
        target.style.removeProperty(property);
        return;
      }
      reservedBlockSize = value;
      target.style.setProperty(property, `${value}px`);
    }

    function applyActiveMetrics(value) {
      activeBlockSize = value > 0 ? value : reservedBlockSize;
      activeSlack = Math.max(0, reservedBlockSize - activeBlockSize);
      target.style.setProperty(currentProperty, `${activeBlockSize}px`);
      target.style.setProperty(slackProperty, `${activeSlack}px`);
      const style = getComputedStyle(target);
      const blockEndInset = (parseFloat(style.paddingBlockEnd) || 0) + (parseFloat(style.borderBlockEndWidth) || 0);
      target.style.setProperty(contentEndProperty, `${Math.max(0, activeBlockSize - blockEndInset)}px`);
      const fontSize = parseFloat(style.fontSize) || 16;
      const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
      target.toggleAttribute("data-flow-stable-spring-active", springEnabled && activeSlack >= lineHeight * 0.65);
      ensureSpring();
    }

    function removeDuplicateIds(probe) {
      probe.removeAttribute("id");
      probe.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    }

    function createProbe(inlineSize) {
      const probe = target.cloneNode(true);
      probe.classList.add("flow-layout-probe");
      probe.removeAttribute("data-flow-stable-layout");
      probe.removeAttribute("data-flow-stable-spring");
      probe.removeAttribute("data-flow-stable-spring-active");
      probe.classList.remove("flow-layout-spring-host");
      probe.querySelectorAll(":scope > .flow-layout-spring").forEach(element => element.remove());
      probe.style.removeProperty(property);
      probe.style.removeProperty(currentProperty);
      probe.style.removeProperty(contentEndProperty);
      probe.style.removeProperty(slackProperty);
      probe.style.setProperty("--flow-layout-probe-inline-size", `${inlineSize}px`);
      probe.setAttribute("aria-hidden", "true");
      probe.setAttribute("inert", "");
      return probe;
    }

    function readProbeBlockSize(probe) {
      removeDuplicateIds(probe);
      probeRoot.append(probe);
      try {
        return probe.getBoundingClientRect().height;
      } finally {
        probe.remove();
      }
    }

    function currentNaturalBlockSize(inlineSize = target.getBoundingClientRect().width) {
      if (!(inlineSize > 0)) return 0;
      return readProbeBlockSize(createProbe(inlineSize));
    }

    function measureNow(includeCurrent = true) {
      measureFrame = 0;
      if (destroyed || !target.isConnected) return;
      const targetBox = target.getBoundingClientRect();
      if (targetBox.width <= 0) return;
      measuredInlineSize = targetBox.width;
      let largest = 0;

      stateBlockSizes = states.map(state => {
        const probe = createProbe(targetBox.width);
        render(probe, state);
        const blockSize = readProbeBlockSize(probe);
        largest = Math.max(largest, blockSize);
        return blockSize;
      });

      const currentNatural = currentNaturalBlockSize(targetBox.width);
      if (!states.length) largest = currentNatural;
      else if (includeCurrent) largest = Math.max(largest, currentNatural);
      applyBlockSize(largest);
      applyActiveMetrics(stateBlockSizes[activeIndex] || currentNatural);
    }

    function refresh() {
      if (destroyed || measureFrame) return;
      measureFrame = global.requestAnimationFrame(() => {
        measureFrame = global.requestAnimationFrame(measureNow);
      });
    }

    function captureNow() {
      captureFrame = 0;
      if (destroyed || !target.isConnected) return;
      ensureSpring();
      const current = currentNaturalBlockSize();
      if (!(current > 0)) return;
      if (current > reservedBlockSize + 0.5) applyBlockSize(current);
      const expected = stateBlockSizes[activeIndex] || current;
      applyActiveMetrics(Math.max(current, expected));
    }

    function capture() {
      if (destroyed || captureFrame) return;
      captureFrame = global.requestAnimationFrame(captureNow);
    }

    function setStates(nextStates, nextActiveIndex = activeIndex) {
      states = Array.from(nextStates || []);
      activeIndex = Math.max(0, Math.min(Number(nextActiveIndex) || 0, Math.max(0, states.length - 1)));
      cancelMeasureFrame();
      cancelCaptureFrame();
      measureNow(false);
    }

    function setActive(nextActiveIndex) {
      activeIndex = Math.max(0, Math.min(Number(nextActiveIndex) || 0, Math.max(0, stateBlockSizes.length - 1)));
      applyActiveMetrics(stateBlockSizes[activeIndex] || currentNaturalBlockSize());
    }

    function flush() {
      cancelMeasureFrame();
      cancelCaptureFrame();
      measureNow();
    }

    const resizeObserver = global.ResizeObserver ? new ResizeObserver(() => {
      const inlineSize = target.getBoundingClientRect().width;
      if (Math.abs(inlineSize - measuredInlineSize) > 0.5) {
        cancelMeasureFrame();
        measureNow();
      }
      else captureNow();
    }) : null;
    resizeObserver?.observe(target);

    const mutationObserver = new MutationObserver(captureNow);
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    cleanup.listen(global, "resize", refresh, { passive: true });
    cleanup.listen(global.visualViewport, "resize", refresh, { passive: true });
    cleanup.listen(target, "load", captureNow, true);
    cleanup.listen(target, "error", captureNow, true);
    cleanup.listen(document.fonts, "loadingdone", refresh);
    document.fonts?.ready.then(() => { if (!destroyed) refresh(); });
    refresh();

    return {
      setStates,
      setActive,
      refresh,
      capture,
      flush,
      getMetrics() {
        return { stateBlockSizes: stateBlockSizes.slice(), activeBlockSize, reservedBlockSize, slack: activeSlack };
      },
      destroy() {
        destroyed = true;
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        cleanup.destroy();
        if (measureFrame) global.cancelAnimationFrame(measureFrame);
        if (captureFrame) global.cancelAnimationFrame(captureFrame);
        target.removeAttribute("data-flow-stable-layout");
        target.removeAttribute("data-flow-stable-spring");
        target.removeAttribute("data-flow-stable-spring-active");
        if (ownsSpringPosition) target.classList.remove("flow-layout-spring-host");
        target.style.removeProperty(property);
        target.style.removeProperty(currentProperty);
        target.style.removeProperty(contentEndProperty);
        target.style.removeProperty(slackProperty);
        spring?.remove();
      }
    };
  }

  /**
   * Replace one semantic native select with the shared paper menu and vertical rail.
   * The native select remains the source of truth for values, changes, and labels.
   */
  function createRoundedSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return { refresh() {}, close() {}, destroy() {} };
    const existing = roundedSelectControllers.get(select);
    if (existing) return existing;
    if (select.nextElementSibling?.classList.contains("flow-rounded-select")) {
      return { refresh() {}, close() {}, destroy() {} };
    }

    const cleanup = createCleanup();
    const originalTabIndex = select.getAttribute("tabindex");
    const originalAriaHidden = select.getAttribute("aria-hidden");
    const hadNativeSelectClass = select.classList.contains("flow-native-select");
    const shell = document.createElement("div");
    shell.className = "flow-rounded-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "flow-rounded-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "flow-rounded-select-menu";
    menu.hidden = true;
    const optionList = document.createElement("div");
    optionList.className = "flow-rounded-select-options";
    optionList.setAttribute("role", "listbox");
    const accessibleLabel = select.getAttribute("aria-label") || select.labels?.[0]?.textContent.trim() || "Select option";
    trigger.setAttribute("aria-label", accessibleLabel);
    optionList.setAttribute("aria-label", accessibleLabel);
    menu.append(optionList);
    const optionRail = createVerticalScrollRail({ viewport: optionList, container: menu, thumbLabel: "Option list vertical position" });
    shell.append(trigger, menu);
    select.classList.add("flow-native-select");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.insertAdjacentElement("afterend", shell);
    let menuFrame = 0;
    let railFrame = 0;
    let destroyed = false;

    function positionMenu() {
      menu.style.left = "0";
      menu.style.right = "auto";
      menu.style.top = "calc(100% + 7px)";
      menu.style.bottom = "auto";
      const bounds = menu.getBoundingClientRect();
      if (bounds.right > global.innerWidth - 12) {
        menu.style.left = "auto";
        menu.style.right = "0";
      }
      const triggerBounds = trigger.getBoundingClientRect();
      const roomBelow = global.innerHeight - triggerBounds.bottom - 19;
      const roomAbove = triggerBounds.top - 19;
      const openAbove = bounds.height > roomBelow && roomAbove > roomBelow;
      if (openAbove) {
        menu.style.top = "auto";
        menu.style.bottom = "calc(100% + 7px)";
      }
      menu.style.setProperty("--flow-rounded-select-available-height", `${Math.max(0, openAbove ? roomAbove : roomBelow)}px`);
    }

    function setOpen(open) {
      if (destroyed) return;
      if (menuFrame) global.cancelAnimationFrame(menuFrame);
      menuFrame = 0;
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
      if (open) {
        menuFrame = global.requestAnimationFrame(() => {
          menuFrame = 0;
          if (destroyed || menu.hidden) return;
          positionMenu();
          optionList.querySelector(".flow-rounded-select-option[aria-selected=\"true\"]")?.scrollIntoView({ block: "nearest" });
          optionRail.update();
        });
      }
    }
    function close() { setOpen(false); }
    function closeOthers() {
      document.querySelectorAll(".flow-rounded-select").forEach(other => {
        if (other === shell) return;
        const otherMenu = other.querySelector(".flow-rounded-select-menu");
        const otherTrigger = other.querySelector(".flow-rounded-select-trigger");
        if (otherMenu) otherMenu.hidden = true;
        if (otherTrigger) otherTrigger.setAttribute("aria-expanded", "false");
      });
    }

    function chooseItem(item) {
      const index = Number(item?.dataset.optionIndex);
      const option = select.options[index];
      if (!option || option.disabled) return;
      const previousIndex = select.selectedIndex;
      select.selectedIndex = index;
      close();
      if (select.selectedIndex !== previousIndex) select.dispatchEvent(new Event("change", { bubbles: true }));
      trigger.focus({ preventScroll: true });
    }

    function refresh() {
      if (destroyed) return;
      const current = select.selectedOptions[0];
      trigger.textContent = current?.textContent || "";
      trigger.disabled = select.disabled || !select.options.length;
      optionList.replaceChildren();
      Array.from(select.options).forEach((option, index) => {
        const item = document.createElement("div");
        item.className = "flow-rounded-select-option";
        item.textContent = option.textContent;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(option.selected));
        item.setAttribute("aria-disabled", String(option.disabled));
        item.dataset.optionIndex = String(index);
        item.tabIndex = option.disabled ? -1 : 0;
        optionList.append(item);
      });
      if (railFrame) global.cancelAnimationFrame(railFrame);
      railFrame = global.requestAnimationFrame(() => {
        railFrame = 0;
        if (!destroyed) optionRail.update();
      });
    }
    cleanup.listen(trigger, "click", event => {
      event.stopPropagation();
      const open = menu.hidden;
      closeOthers();
      setOpen(open);
    });
    cleanup.listen(trigger, "keydown", event => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (menu.hidden) trigger.click();
        menu.querySelector(".flow-rounded-select-option[aria-selected=\"true\"]")?.focus();
      }
    });
    cleanup.listen(optionList, "click", event => {
      const item = closestWithin(event.target, ".flow-rounded-select-option", optionList);
      if (item) chooseItem(item);
    });
    cleanup.listen(optionList, "keydown", event => {
      const item = closestWithin(event.target, ".flow-rounded-select-option", optionList);
      if (item && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        chooseItem(item);
      }
    });
    cleanup.listen(shell, "keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus({ preventScroll: true });
        return;
      }
      const item = closestWithin(event.target, ".flow-rounded-select-option", optionList);
      if (!item || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(optionList.querySelectorAll(".flow-rounded-select-option:not([aria-disabled=\"true\"])"));
      const index = items.indexOf(item);
      const nextIndex = event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[nextIndex]?.focus({ preventScroll: true });
    });
    cleanup.listen(document, "pointerdown", event => { if (!shell.contains(event.target)) close(); });
    cleanup.listen(select, "change", refresh);
    const observer = new MutationObserver(refresh);
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    refresh();
    const controller = {
      shell,
      trigger,
      menu,
      refresh,
      close,
      destroy() {
        if (destroyed) return;
        close();
        destroyed = true;
        if (menuFrame) global.cancelAnimationFrame(menuFrame);
        if (railFrame) global.cancelAnimationFrame(railFrame);
        menuFrame = 0;
        railFrame = 0;
        cleanup.destroy();
        observer.disconnect();
        optionRail.destroy();
        shell.remove();
        if (!hadNativeSelectClass) select.classList.remove("flow-native-select");
        if (originalTabIndex === null) select.removeAttribute("tabindex");
        else select.setAttribute("tabindex", originalTabIndex);
        if (originalAriaHidden === null) select.removeAttribute("aria-hidden");
        else select.setAttribute("aria-hidden", originalAriaHidden);
        roundedSelectControllers.delete(select);
      }
    };
    roundedSelectControllers.set(select, controller);
    return controller;
  }

  /** Create the top SVG layer that holds one transient focused edge copy. */
  function createFocusLayer(options) {
    return createSvgLayer(options, "flow-edge-focus-layer");
  }

  /** Create an SVG hit layer when HTML state cells sit above routed edges. */
  function createHitLayer(options) {
    return createSvgLayer(options, "flow-edge-hit-layer");
  }

  /** Mirror edge hit paths into a dedicated layer without changing visual edge order. */
  function syncHitLayer(options) {
    const root = options.root;
    const layer = options.layer;
    if (!root || !layer) return;
    layer.setAttribute("viewBox", root.getAttribute("viewBox") || "");
    layer.replaceChildren();
    root.querySelectorAll(".flow-edge-wrap").forEach(edge => {
      const hit = edge.querySelector(".flow-edge-hit");
      if (!hit) return;
      const copy = edge.cloneNode(false);
      copy.removeAttribute("tabindex");
      copy.classList.add("flow-edge-hit-copy");
      copy.append(hit.cloneNode(true));
      layer.append(copy);
    });
  }

  function pointOnBox(box, side, port, clearance) {
    const offset = port || 0;
    const gap = clearance || 0;
    if (side === "left") return { x: box.x - gap, y: box.y + box.height / 2 + offset, nx: -1, ny: 0 };
    if (side === "top") return { x: box.x + box.width / 2 + offset, y: box.y - gap, nx: 0, ny: -1 };
    if (side === "bottom") return { x: box.x + box.width / 2 + offset, y: box.y + box.height + gap, nx: 0, ny: 1 };
    return { x: box.x + box.width + gap, y: box.y + box.height / 2 + offset, nx: 1, ny: 0 };
  }

  function cubicPoint(a, c1, c2, b, t) {
    const u = 1 - t;
    return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y };
  }

  function cubicTangent(a, c1, c2, b, t) {
    const u = 1 - t;
    return { x: 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x), y: 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y) };
  }

  function sampleRoute(route, count) {
    const samples = [];
    for (let i = 0; i <= count; i += 1) samples.push(cubicPoint(route.a, route.c1, route.c2, route.b, i / count));
    return samples;
  }

  function insideRect(point, rect, margin) {
    return point.x > rect.x - margin && point.x < rect.x + rect.width + margin && point.y > rect.y - margin && point.y < rect.y + rect.height + margin;
  }

  function rectsOverlap(a, b, margin) {
    const gap = margin || 0;
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  }

  function makeRoute(edge, boxes, occupied, labels) {
    const fromBox = boxes[edge.from];
    const toBox = boxes[edge.to];
    if (!fromBox || !toBox) return null;
    const a = pointOnBox(fromBox, edge.fromSide || "right", edge.fromPort, edge.sourceClearance === undefined ? 8 : edge.sourceClearance);
    const b = pointOnBox(toBox, edge.toSide || "left", edge.toPort, edge.targetClearance === undefined ? 12 : edge.targetClearance);
    const laneBase = edge.lane || 0;
    const lanes = [laneBase, laneBase + 20, laneBase - 20];
    let best = null;

    lanes.forEach(lane => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthBetweenNodes = Math.max(1, Math.hypot(dx, dy));
      const bendX = -dy / lengthBetweenNodes;
      const bendY = dx / lengthBetweenNodes;
      const facesTarget = a.nx * b.nx + a.ny * b.ny < -0.5;
      const directGap = Math.abs(dx * a.nx + dy * a.ny);
      const freeDistance = facesTarget ? Math.max(8, directGap * 0.38) : 38;
      const distance = edge.push || Math.min(Math.max(lengthBetweenNodes * 0.28, freeDistance), facesTarget ? Math.max(8, directGap * 0.44) : 138);
      const endLane = edge.endLane === undefined ? lane : edge.endLane;
      const c1 = { x: a.x + a.nx * distance + bendX * lane, y: a.y + a.ny * distance + bendY * lane };
      const c2 = { x: b.x + b.nx * distance + bendX * endLane, y: b.y + b.ny * distance + bendY * endLane };
      const route = { a, c1, c2, b };
      const samples = sampleRoute(route, 22);
      let score = 0;
      let blocked = false;
      Object.entries(boxes).forEach(([key, rect]) => {
        const routeSamples = (key === edge.from || key === edge.to) ? samples.slice(2, -2) : samples;
        if (routeSamples.some(point => insideRect(point, rect, 11))) { score += 100000; blocked = true; }
      });
      occupied.forEach(other => {
        let overlapHits = 0;
        samples.slice(2, -2).forEach(point => other.samples.slice(2, -2).forEach(otherPoint => { if (Math.hypot(point.x - otherPoint.x, point.y - otherPoint.y) < 10) overlapHits += 1; }));
        score += overlapHits * 16;
        if (overlapHits > 8) blocked = true;
      });
      const labelAt = edge.labelAt === undefined ? edge.labelAnchor : edge.labelAt;
      const t = labelAt === undefined ? 0.5 : labelAt;
      const center = cubicPoint(a, c1, c2, b, t);
      const tangent = cubicTangent(a, c1, c2, b, t);
      const length = Math.max(1, Math.hypot(tangent.x, tangent.y));
      const labelOffset = edge.labelOffset === undefined ? 0 : edge.labelOffset;
      const label = { x: center.x + (-tangent.y / length) * labelOffset, y: center.y + (tangent.x / length) * labelOffset };
      const hasVisibleLabel = String(edge.label || "").trim().length > 0;
      const labelWidth = hasVisibleLabel ? Math.max(44, String(edge.label).length * 7.1) : 0;
      const labelRect = { x: label.x - labelWidth / 2, y: label.y - (hasVisibleLabel ? 10 : 0), width: labelWidth, height: hasVisibleLabel ? 18 : 0 };
      if (hasVisibleLabel) {
        Object.values(boxes).forEach(rect => { if (rectsOverlap(labelRect, rect, 8)) { score += 100000; blocked = true; } });
        labels.forEach(other => { if (rectsOverlap(labelRect, other, 4)) { score += 30000; blocked = true; } });
        occupied.forEach(other => { if (other.samples.slice(2, -2).some(point => insideRect(point, labelRect, 4))) blocked = true; });
      }
      const candidate = { ...route, samples, label, labelRect, score, blocked };
      if (!best || (best.blocked && !candidate.blocked) || (best.blocked === candidate.blocked && score < best.score)) best = candidate;
    });
    // Preserve the semantic edge even where its label cannot avoid every nearby node.
    // The candidate ranking still chooses the least obstructive natural curve.
    return best;
  }

  // Anchor the route at the rear-center of the open V, so the final dash enters on its angle bisector.
  function ensureOpenMarkers(svg, colors, names = []) {
    const prefix = markerPrefixFor(svg);
    let defs = svg.querySelector("defs");
    if (!defs) { defs = document.createElementNS(SVG_NS, "defs"); svg.prepend(defs); }
    const palette = { ...DEFAULT_MARKER_COLORS, ...(colors || {}) };
    names.forEach(name => { if (!Object.hasOwn(palette, name)) palette[name] = palette.default; });
    const markerIds = new Set(Object.keys(palette).flatMap(name => [markerId(prefix, name), markerId(prefix, name, true)]));
    defs.querySelectorAll("marker[data-flow-marker-prefix]").forEach(marker => {
      if (marker.dataset.flowMarkerPrefix !== prefix || !markerIds.has(marker.id)) marker.remove();
    });
    Object.entries(palette).forEach(([name, color]) => {
      [false, true].forEach(active => {
        const id = markerId(prefix, name, active);
        let marker = Array.from(defs.children).find(element => element.id === id);
        if (!marker) {
          marker = document.createElementNS(SVG_NS, "marker");
          marker.setAttribute("id", id); marker.setAttribute("viewBox", "0 0 12 12"); marker.setAttribute("refX", "1"); marker.setAttribute("refY", "6"); marker.setAttribute("markerWidth", "12"); marker.setAttribute("markerHeight", "12"); marker.setAttribute("markerUnits", "userSpaceOnUse"); marker.setAttribute("orient", "auto-start-reverse");
          defs.append(marker);
        }
        marker.dataset.flowMarkerPrefix = prefix;
        let path = marker.querySelector("path");
        if (!path) { path = document.createElementNS(SVG_NS, "path"); marker.append(path); }
        path.setAttribute("d", "M 1 1 L 11 6 L 1 11"); path.setAttribute("fill", "none"); path.setAttribute("stroke", color); path.setAttribute("stroke-width", active ? "2.25" : "2.1"); path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
      });
    });
    return prefix;
  }

  function appendRoutedEdge(svg, edge, route, markerPrefix) {
    const group = document.createElementNS(SVG_NS, "g");
    const key = edge.key || `edge-${edge.from}-${edge.to}`;
    group.setAttribute("class", `flow-edge-wrap ${edge.kind || ""} ${edge.flowing ? "is-flowing" : ""}`.trim()); group.setAttribute("tabindex", "0"); group.setAttribute("data-key", key); group.setAttribute("aria-label", edge.label || key);
    const d = `M ${route.a.x} ${route.a.y} C ${route.c1.x} ${route.c1.y}, ${route.c2.x} ${route.c2.y}, ${route.b.x} ${route.b.y}`;
    const hit = document.createElementNS(SVG_NS, "path");
    hit.setAttribute("class", "flow-edge-hit"); hit.setAttribute("d", d); group.append(hit);
    const path = document.createElementNS(SVG_NS, "path");
    const marker = edge.marker || edge.kind || "default";
    const normalMarkerId = markerId(markerPrefix, marker);
    const activeMarkerId = markerId(markerPrefix, marker, true);
    path.setAttribute("class", `flow-edge ${edge.kind || ""}`.trim()); path.setAttribute("data-marker", marker); path.setAttribute("data-marker-id", normalMarkerId); path.setAttribute("data-marker-active-id", activeMarkerId); path.setAttribute("d", d); path.setAttribute("marker-end", `url(#${normalMarkerId})`); group.append(path);
    if (Object.prototype.hasOwnProperty.call(edge, "label")) {
      const bg = document.createElementNS(SVG_NS, "rect");
      bg.setAttribute("class", "flow-edge-label-bg"); bg.setAttribute("x", route.labelRect.x); bg.setAttribute("y", route.labelRect.y); bg.setAttribute("width", route.labelRect.width); bg.setAttribute("height", route.labelRect.height); bg.setAttribute("rx", "8"); bg.setAttribute("ry", "8"); group.append(bg);
      const text = document.createElementNS(SVG_NS, "text"); text.setAttribute("class", "flow-edge-label"); text.setAttribute("x", route.label.x); text.setAttribute("y", route.label.y); text.setAttribute("text-anchor", "middle"); text.textContent = edge.label || ""; group.append(text);
    }
    svg.append(group);
  }

  /**
   * Render data-defined cubic edges into one SVG layer.
   * Each edge owns its hit path, visual curve, open marker, label backdrop, and label.
   */
  function renderRoutedEdges(options) {
    const svg = options.svg;
    const root = options.root;
    const edges = Array.isArray(options.edges) ? options.edges : [];
    const selector = options.nodeSelector || ".flow-node";
    if (!svg || !root) return [];
    const rendered = [];
    const rejected = [];
    rendered.rejected = rejected;
    svg.dispatchEvent(new CustomEvent("flow:before-render"));
    try {
      const boxes = {};
      const rootRect = root.getBoundingClientRect();
      root.querySelectorAll(selector).forEach(node => {
        if (node.hidden || !node.dataset.key) return;
        const rect = node.getBoundingClientRect();
        boxes[node.dataset.key] = { x: rect.left - rootRect.left, y: rect.top - rootRect.top, width: rect.width, height: rect.height };
      });
      if (options.edges != null && !Array.isArray(options.edges)) rejected.push("edges (expected an array)");
      const occupied = [];
      const labels = [];
      const planned = [];
      edges.forEach((edge, index) => {
        if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
          rejected.push(`edge-${index} (expected an object)`);
          return;
        }
        const key = edge.key || `${edge.from}-${edge.to}`;
        const missing = [!boxes[edge.from] && `from:${edge.from}`, !boxes[edge.to] && `to:${edge.to}`].filter(Boolean);
        if (missing.length) { rejected.push(`${key} (${missing.join(", ")})`); return; }
        const route = makeRoute(edge, boxes, occupied, labels);
        if (!route) { rejected.push(key); return; }
        planned.push({ edge, route });
        occupied.push(route);
        if (route.labelRect.width) labels.push(route.labelRect);
      });

      const markerNames = planned.map(({ edge }) => edge.marker || edge.kind || "default");
      const markerPrefix = ensureOpenMarkers(svg, options.markerColors, markerNames);
      const fragment = document.createDocumentFragment();
      planned.forEach(({ edge, route }) => appendRoutedEdge(fragment, edge, route, markerPrefix));
      const previous = Array.from(svg.querySelectorAll(".flow-edge-wrap"));
      svg.append(fragment);
      previous.forEach(edge => edge.remove());
      rendered.push(...planned);
      if (rejected.length && typeof options.onRejected === "function") options.onRejected(rejected);
      return rendered;
    } finally {
      svg.dispatchEvent(new CustomEvent("flow:after-render", { detail: { rendered, rejected } }));
    }
  }

  function transferCellKey(rank, buffer) {
    return `rank-${rank}-${buffer}`;
  }

  function appendTransferDetail(cell, title, detail, enabled, className = "") {
    if (!enabled || !detail) return;
    const card = document.createElement("div");
    card.className = "flow-transfer-detail" + (className ? " " + className : "");
    const heading = document.createElement("strong");
    heading.className = "flow-transfer-detail-title";
    heading.textContent = title;
    card.append(heading);
    detail.split("\n").filter(Boolean).forEach(line => {
      const row = document.createElement("span");
      row.className = "flow-transfer-detail-line";
      row.textContent = line;
      card.append(row);
    });
    cell.append(card);
  }

  /**
   * Render stable HTML cells for a stepped state trace.
   * Snapshot data changes cell content and state; it never relocates a cell.
   */
  function renderTransferLanes(options) {
    const root = options.root;
    const ranks = options.ranks || [];
    const chunks = options.chunks || [];
    const layout = options.layout === "tree" ? "tree" : "grid";
    const parents = options.parents || {};
    const stateFor = options.stateFor || (() => "source");
    const labelFor = options.labelFor || ((rank, chunk, state) => `${chunk} [${state}]`);
    const contentFor = options.contentFor || ((rank, chunk, state) => ({ key: chunk, value: labelFor(rank, chunk, state) }));
    const cellKeyFor = options.cellKey || transferCellKey;
    const groupKeyFor = options.groupKeyFor || (rank => `rank-${rank}`);
    const groupLabelFor = options.groupLabelFor || (rank => `rank ${rank}`);
    const aggregateDetailFor = options.aggregateDetailFor || ((rank, vector) => ({
      title: groupLabelFor(rank),
      detail: `[${vector.join(", ")}]`
    }));
    const updatedKeys = new Set(Array.from(options.updatedKeys || [], String));
    const detailMode = options.detail === "none" ? "none" : "hover";
    if (!root) return [];
    root.style.setProperty("--flow-transfer-cells", String(Math.max(1, chunks.length)));
    const signature = JSON.stringify({
      layout,
      ranks: ranks.map(String),
      chunks: chunks.map(String),
      parents: Object.entries(parents).sort(([left], [right]) => left.localeCompare(right)).map(([child, parent]) => [child, String(parent)]),
      groupKeys: ranks.map(rank => String(groupKeyFor(rank))),
      groupLabels: ranks.map(rank => String(groupLabelFor(rank))),
      cellKeys: ranks.map(rank => chunks.map(chunk => String(cellKeyFor(rank, chunk))))
    });
    const rebuild = root.dataset.transferSignature !== signature;
    if (rebuild) {
      root.replaceChildren();
      root.dataset.flowLayout = layout;
      const treeLevels = new Map();
      if (layout === "tree") {
        const rankKeys = ranks.map(String);
        const children = new Map(rankKeys.map(rank => [rank, []]));
        const roots = rankKeys.filter(rank => !Object.hasOwn(parents, rank));
        Object.entries(parents).forEach(([child, parent]) => children.get(String(parent))?.push(String(child)));
        const queue = roots.map(rank => ({ rank, depth: 0 }));
        while (queue.length) {
          const { rank, depth } = queue.shift();
          if (treeLevels.has(rank)) continue;
          treeLevels.set(rank, depth);
          children.get(rank)?.forEach(child => queue.push({ rank: child, depth: depth + 1 }));
        }
        rankKeys.filter(rank => !treeLevels.has(rank)).forEach(rank => treeLevels.set(rank, 0));
      }
      const maxDepth = Math.max(0, ...treeLevels.values());
      const ranksAtDepth = depth => ranks.filter(rank => treeLevels.get(String(rank)) === depth);
      ranks.forEach(rank => {
        const rankKey = String(rank);
        const lane = document.createElement("div");
        lane.className = layout === "tree" ? "flow-topology-rank" : "flow-transfer-lane";
        lane.dataset.rank = rankKey;
        if (layout === "tree") {
          lane.dataset.key = groupKeyFor(rank);
          lane.toggleAttribute("data-flow-root", !Object.hasOwn(parents, rankKey));
        }
        if (layout === "tree") {
          const depth = treeLevels.get(rankKey) || 0;
          const peers = ranksAtDepth(depth);
          const peerIndex = peers.indexOf(rank);
          lane.style.setProperty("--flow-topology-x", `${((peerIndex + 1) / (peers.length + 1)) * 100}%`);
          lane.style.setProperty("--flow-topology-y", `${maxDepth ? 8 + (depth / maxDepth) * 78 : 48}%`);
          if (peers.length > 1) {
            lane.dataset.flowDetailAlign = peerIndex < (peers.length - 1) / 2 ? "start" : "end";
          }
        }
        const title = document.createElement("div");
        title.className = "flow-transfer-lane-label";
        title.textContent = groupLabelFor(rank);
        lane.append(title);
        const buffer = layout === "tree" ? document.createElement("div") : lane;
        if (layout === "tree") {
          buffer.className = "flow-topology-buffer";
          lane.append(buffer);
        }
        chunks.forEach(chunk => {
          const cell = document.createElement("div");
          cell.className = "flow-transfer-cell";
          cell.tabIndex = layout === "tree" ? -1 : 0;
          cell.dataset.key = cellKeyFor(rank, chunk);
          cell.addEventListener("animationend", event => {
            if (event.animationName === "flow-transfer-update") cell.removeAttribute("data-flow-changing");
          });
          buffer.append(cell);
        });
        if (layout === "tree") {
          const hitbox = document.createElement("div");
          hitbox.className = "flow-topology-hitbox";
          hitbox.tabIndex = 0;
          buffer.append(hitbox);
        }
        root.append(lane);
      });
      root.dataset.transferSignature = signature;
    }
    const cells = [];
    ranks.forEach(rank => {
      const laneClass = layout === "tree" ? ".flow-topology-rank" : ".flow-transfer-lane";
      const lane = Array.from(root.querySelectorAll(laneClass)).find(element => element.dataset.rank === String(rank));
      const rankCells = [];
      const rankVector = [];
      chunks.forEach(chunk => {
        const stateInfo = stateFor(rank, chunk) || "source";
        const state = typeof stateInfo === "string" ? stateInfo : (stateInfo.state || "source");
        const cellKey = String(cellKeyFor(rank, chunk));
        const cell = Array.from(lane?.querySelectorAll(".flow-transfer-cell") || []).find(element => element.dataset.key === cellKey);
        if (!cell) return;
        const content = contentFor(rank, chunk, stateInfo) || {};
        const key = String(content.key ?? chunk);
        const value = String(content.value ?? labelFor(rank, chunk, stateInfo));
        const detail = String(content.detail ?? `${key} = ${value}`);
        const changed = cell.dataset.flowState !== state || cell.dataset.flowValue !== value;
        cell.dataset.flowState = state;
        cell.dataset.flowValue = value;
        const cellDetailEnabled = detailMode === "hover" && layout !== "tree";
        if (cellDetailEnabled) {
          cell.dataset.flowDetail = detail;
          cell.dataset.flowDetailTitle = "rank " + rank + " / " + key;
          cell.dataset.flowDetailEnabled = "true";
          cell.setAttribute("aria-label", cell.dataset.flowDetail);
        } else {
          delete cell.dataset.flowDetail;
          delete cell.dataset.flowDetailTitle;
          cell.dataset.flowDetailEnabled = "false";
          cell.removeAttribute("aria-label");
        }
        cell.replaceChildren();
        const keyElement = document.createElement("span");
        keyElement.className = "flow-transfer-cell-key";
        keyElement.textContent = key;
        const valueElement = document.createElement("strong");
        valueElement.className = "flow-transfer-cell-value";
        valueElement.textContent = value;
        cell.append(keyElement, valueElement);
        appendTransferDetail(cell, cell.dataset.flowDetailTitle || "", detail, cellDetailEnabled);
        const isUpdated = updatedKeys.has(cell.dataset.key);
        cell.toggleAttribute("data-flow-updated", isUpdated);
        if (changed && !rebuild) {
          cell.removeAttribute("data-flow-changing");
          void cell.offsetWidth;
          cell.setAttribute("data-flow-changing", "");
        }
        cells.push(cell);
        rankCells.push(cell);
        rankVector.push(`${key} = ${value}`);
      });
      if (layout === "tree") {
        const buffer = lane?.querySelector(":scope > .flow-topology-buffer");
        const hitbox = buffer?.querySelector(":scope > .flow-topology-hitbox");
        hitbox?.querySelector(":scope > .flow-topology-detail")?.remove();
        const aggregate = detailMode === "hover" && rankVector.length ? aggregateDetailFor(rank, rankVector, rankCells) : null;
        const detail = typeof aggregate === "string" ? aggregate : String(aggregate?.detail || "");
        const detailTitle = typeof aggregate === "string" ? groupLabelFor(rank) : String(aggregate?.title || groupLabelFor(rank));
        if (detail && hitbox) {
          lane.dataset.flowDetail = detail;
          lane.dataset.flowDetailTitle = detailTitle;
          lane.dataset.flowDetailEnabled = "true";
          lane.setAttribute("aria-label", detail);
          hitbox.setAttribute("aria-label", detailTitle + ": " + detail.replaceAll("\n", " "));
          appendTransferDetail(hitbox, detailTitle, detail, true, "flow-topology-detail");
        } else {
          delete lane.dataset.flowDetail;
          delete lane.dataset.flowDetailTitle;
          lane.dataset.flowDetailEnabled = "false";
          lane.removeAttribute("aria-label");
          hitbox?.removeAttribute("aria-label");
        }
      }
    });
    return cells;
  }

  /**
   * Adapt state-transfer records to the shared routed-edge renderer.
   * Real transfers flow by default; set transfer.flowing to false for a static route.
   */
  function renderTransferEdges(options) {
    const transfers = options.transfers == null
      ? []
      : (Array.isArray(options.transfers) ? options.transfers : [null]);
    const cellKey = options.cellKey || transferCellKey;
    const endpointKeyFor = options.endpointKeyFor || ((transfer, endpoint) => endpoint === "from"
      ? (transfer.from || cellKey(transfer.fromRank, transfer.fromBuffer))
      : (transfer.to || cellKey(transfer.toRank, transfer.toBuffer)));
    const edges = transfers.map(transfer => {
      if (!transfer || typeof transfer !== "object" || Array.isArray(transfer)) return null;
      return {
        key: transfer.key || `transfer-${transfer.fromRank}-${transfer.fromBuffer}-${transfer.toRank}-${transfer.toBuffer}-${transfer.chunk}`,
        from: endpointKeyFor(transfer, "from"),
        to: endpointKeyFor(transfer, "to"),
        fromSide: transfer.fromSide,
        toSide: transfer.toSide,
        fromPort: transfer.fromPort,
        toPort: transfer.toPort,
        lane: transfer.lane,
        endLane: transfer.endLane,
        push: transfer.push,
        labelAt: transfer.labelAt,
        labelAnchor: transfer.labelAnchor,
        labelOffset: transfer.labelOffset,
        label: transfer.label || `${transfer.chunk}: ${transfer.action}`,
        kind: transfer.kind || "data",
        marker: transfer.marker || transfer.kind || "data",
        flowing: transfer.flowing !== false,
        sourceClearance: transfer.sourceClearance,
        targetClearance: transfer.targetClearance
      };
    });
    return renderRoutedEdges({
      root: options.root,
      svg: options.svg,
      edges,
      nodeSelector: options.nodeSelector || ".flow-transfer-cell",
      markerColors: options.markerColors,
      onRejected: options.onRejected
    });
  }

  /** Validate that declared state snapshots cover every visible cell and transfer field. */
  function validateTransferTopologies(operators) {
    const errors = [];
    const isRecord = value => !!value && typeof value === "object" && !Array.isArray(value);
    function arrayField(owner, field, context) {
      const value = owner[field];
      if (value == null) return [];
      if (Array.isArray(value)) return value;
      errors.push(`${context}: ${field} must be an array`);
      return [];
    }
    if (operators == null) return errors;
    if (!Array.isArray(operators)) return ["operators must be an array"];
    operators.forEach((operator, operatorIndex) => {
      if (!isRecord(operator)) {
        errors.push(`operator ${operatorIndex}: expected an object`);
        return;
      }
      const operatorKey = String(operator.key ?? `operator-${operatorIndex}`);
      if (Object.hasOwn(operator, "phases")) errors.push(`${operatorKey}: legacy phases data is not allowed`);
      const variants = arrayField(operator, "topologyVariants", operatorKey);
      if (!variants.length) errors.push(`${operatorKey}: missing topologyVariants`);
      variants.forEach((variant, variantIndex) => {
        if (!isRecord(variant)) {
          errors.push(`${operatorKey}/variant-${variantIndex}: expected an object`);
          return;
        }
        const id = `${operatorKey}/${variant.name || "unnamed"}`;
        const ranks = arrayField(variant, "ranks", id);
        const chunks = arrayField(variant, "chunks", id);
        const phases = arrayField(variant, "phases", id);
        if (!phases.length) errors.push(`${id}: missing phases`);
        const transferKeys = new Set();
        const normalizedPhases = [];
        phases.forEach((phase, phaseIndex) => {
          if (!isRecord(phase)) {
            errors.push(`${id}/phase-${phaseIndex}: expected an object`);
            return;
          }
          const phaseName = String(phase.name ?? `phase-${phaseIndex}`);
          const cellStates = isRecord(phase.cellStates) ? phase.cellStates : null;
          if (!cellStates) errors.push(`${id}/${phaseName}: missing cellStates`);
          ranks.forEach(rank => chunks.forEach(chunk => {
            if (cellStates?.[transferCellKey(rank, chunk)] === undefined) errors.push(`${id}/${phaseName}: missing cell state for rank ${rank} ${chunk}`);
          }));
          const transfers = arrayField(phase, "transfers", `${id}/${phaseName}`);
          const validTransfers = [];
          transfers.forEach((transfer, transferIndex) => {
            if (!isRecord(transfer)) {
              errors.push(`${id}/${phaseName}/transfer-${transferIndex}: expected an object`);
              return;
            }
            validTransfers.push(transfer);
            ["key", "fromRank", "fromBuffer", "toRank", "toBuffer", "chunk", "action", "kind", "fromSide", "toSide", "lane"].forEach(field => {
              if (transfer[field] === undefined || transfer[field] === null || transfer[field] === "") errors.push(`${id}/${phaseName}: missing ${field}`);
            });
            if (transfer.key && transferKeys.has(transfer.key)) errors.push(`${id}: duplicate transfer key ${transfer.key}`);
            transferKeys.add(transfer.key);
          });
          normalizedPhases.push({ phase, transfers: validTransfers, phaseName });
        });
        if (variant.name === "ring") {
          normalizedPhases.forEach(({ phase, transfers, phaseName }) => {
            ranks.forEach(rank => {
              if (phase.initial || !transfers.length) return;
              if (!transfers.some(transfer => transfer.fromRank === rank)) errors.push(`${id}/${phaseName}: missing outgoing hop for rank ${rank}`);
              if (!transfers.some(transfer => transfer.toRank === rank)) errors.push(`${id}/${phaseName}: missing incoming hop for rank ${rank}`);
            });
          });
        }
        if (variant.name === "tree") {
          if (!isRecord(variant.parents)) errors.push(`${id}: missing parent map`);
          if (variant.resultScope !== "root-only" && variant.resultScope !== "all-ranks") errors.push(`${id}: missing resultScope`);
          const parents = isRecord(variant.parents) ? variant.parents : {};
          const roots = ranks.filter(rank => !Object.hasOwn(parents, rank));
          if (roots.length !== 1) errors.push(`${id}: expected exactly one root`);
          ranks.filter(rank => rank !== roots[0]).forEach(rank => {
            if (!ranks.includes(parents[rank])) errors.push(`${id}: invalid parent for rank ${rank}`);
          });
          ranks.forEach(rank => {
            const visited = new Set();
            let current = rank;
            while (Object.hasOwn(parents, current)) {
              const key = String(current);
              if (visited.has(key)) { errors.push(`${id}: parent cycle reaches rank ${rank}`); break; }
              visited.add(key);
              current = parents[current];
            }
            if (roots.length === 1 && String(current) !== String(roots[0])) errors.push(`${id}: rank ${rank} is disconnected from root ${roots[0]}`);
          });
          const up = normalizedPhases.find(({ phase }) => phase.direction === "tree-up");
          const down = normalizedPhases.find(({ phase }) => phase.direction === "tree-down");
          if (!up) errors.push(`${id}: missing tree-up phase`);
          if (variant.resultScope === "all-ranks" && !down) errors.push(`${id}: all-ranks result requires tree-down phase`);
          if (variant.resultScope === "root-only" && down) errors.push(`${id}: root-only result must not include tree-down phase`);
          (up?.transfers || []).forEach(transfer => {
            if (parents[transfer.fromRank] !== transfer.toRank) errors.push(`${id}/tree-up: edge does not target parent`);
          });
          (down?.transfers || []).forEach(transfer => {
            if (parents[transfer.toRank] !== transfer.fromRank) errors.push(`${id}/tree-down: edge does not originate at parent`);
          });
        }
      });
    });
    return errors;
  }

  /**
   * Bind transient hover and keyboard focus to one component set.
   * SVG edges use the focus layer; HTML components raise their existing frame in place.
   */
  function bindFocus(options) {
    const root = options.root;
    const selector = options.selector;
    const itemFor = options.itemFor;
    const render = options.render;
    const focusLayer = options.focusLayer || null;
    const eventRoot = options.eventRoot || focusLayer?.parentElement || root;
    const persistent = options.persistent === true;
    const blank = options.blank || (() => false);
    const selected = { value: null };
    const preview = { value: null };
    let raised = null;
    let restoreTimer = 0;
    let focusFrame = 0;
    if (!root || !selector || !itemFor) {
      return { preview() {}, select() {}, clear() {}, clearPreview() {}, destroy() {}, state: { selected, preview } };
    }
    const cleanup = createCleanup();

    function elementFor(target) {
      return closestWithin(target, selector, root);
    }

    function apply() {
      let activeElement = null;
      const elements = Array.from(root.querySelectorAll(selector));
      if (raised?.element && !elements.includes(raised.element)) elements.push(raised.element);
      elements.forEach(element => {
        const item = itemFor(element);
        const isSelected = !!selected.value && item?.key === selected.value.key;
        const isPreview = !selected.value && !!preview.value && item?.key === preview.value.key;
        element.classList.toggle("is-selected", isSelected);
        element.classList.toggle("is-preview", isPreview);
        if (isSelected || isPreview) activeElement = element;
      });
      elements.flatMap(element => Array.from(element.querySelectorAll?.(".flow-edge") || [])).forEach(edge => {
        const group = edge.parentElement;
        const active = group?.classList.contains("is-selected") || group?.classList.contains("is-preview");
        const marker = active ? edge.dataset.markerActiveId : edge.dataset.markerId;
        if (marker) edge.setAttribute("marker-end", `url(#${marker})`);
      });
      if (root instanceof SVGElement) {
        syncRaised(activeElement);
      }
      if (typeof render === "function") render({ selected: selected.value, preview: preview.value, active: selected.value || preview.value || null });
    }

    function restoreRaised() {
      if (!raised) return;
      const { element, parent, next } = raised;
      if (focusLayer) {
        element.classList.remove("is-focus-source-hidden");
        focusLayer.classList.remove("is-active");
        restoreTimer = global.setTimeout(() => {
          restoreTimer = 0;
          if (!focusLayer.classList.contains("is-active")) focusLayer.replaceChildren();
        }, 130);
      } else if (element.parentNode === parent) {
        parent.insertBefore(element, next?.parentNode === parent ? next : null);
      }
      raised = null;
    }

    function syncRaised(element) {
      if (raised?.element === element) return;
      restoreRaised();
      if (!element?.parentNode) return;
      raised = { element, parent: element.parentNode, next: element.nextSibling };
      if (focusLayer) {
        if (restoreTimer) global.clearTimeout(restoreTimer);
        restoreTimer = 0;
        focusLayer.replaceChildren();
        const viewBox = root.getAttribute("viewBox");
        if (viewBox) focusLayer.setAttribute("viewBox", viewBox);
        const visualCopy = element.cloneNode(true);
        visualCopy.removeAttribute("tabindex");
        visualCopy.classList.add("flow-edge-focus-copy");
        visualCopy.querySelectorAll(".flow-edge").forEach(edge => {
          const activeMarkerId = edge.dataset.markerActiveId;
          if (activeMarkerId) edge.setAttribute("marker-end", `url(#${activeMarkerId})`);
        });
        focusLayer.append(visualCopy);
        element.classList.add("is-focus-source-hidden");
        focusFrame = global.requestAnimationFrame(() => {
          focusFrame = 0;
          if (raised?.element === element) focusLayer.classList.add("is-active");
        });
        return;
      }
      raised.parent.append(element);
    }

    function sameItem(a, b) { return a?.key === b?.key; }
    function setPreview(item) {
      if (sameItem(preview.value, item)) return;
      preview.value = item;
      apply();
    }
    function clearPreview() {
      if (!preview.value) return;
      preview.value = null;
      apply();
    }
    function select(item) {
      if (sameItem(selected.value, item)) return;
      selected.value = item;
      apply();
    }
    function clear() {
      if (!selected.value && !preview.value) return;
      selected.value = null;
      preview.value = null;
      apply();
    }

    cleanup.listen(eventRoot, "pointerover", event => {
      const element = elementFor(event.target);
      if (element && !element.contains(event.relatedTarget)) setPreview(itemFor(element));
    });
    cleanup.listen(eventRoot, "pointerout", event => {
      const element = elementFor(event.target);
      if (element && !element.contains(event.relatedTarget)) clearPreview();
    });
    cleanup.listen(eventRoot, "focusin", event => {
      const element = elementFor(event.target);
      if (element) setPreview(itemFor(element));
    });
    cleanup.listen(eventRoot, "focusout", event => {
      const element = elementFor(event.target);
      if (element && !element.contains(event.relatedTarget)) clearPreview();
    });
    cleanup.listen(eventRoot, "click", event => {
      const element = elementFor(event.target);
      if (element) { event.stopPropagation(); if (persistent) select(itemFor(element)); }
      else if (blank(event)) clear();
    });
    cleanup.listen(eventRoot, "keydown", event => {
      const element = elementFor(event.target);
      if (element && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        if (persistent) select(itemFor(element));
      }
    });
    cleanup.listen(global, "keydown", event => { if (event.key === "Escape") clear(); });
    cleanup.listen(root, "flow:before-render", clear);
    apply();
    return {
      preview: setPreview,
      select,
      clear,
      clearPreview,
      state: { selected, preview },
      destroy() {
        cleanup.destroy();
        selected.value = null;
        preview.value = null;
        root.querySelectorAll(selector).forEach(element => {
          element.classList.remove("is-selected", "is-preview", "is-focus-source-hidden");
        });
        restoreRaised();
        if (restoreTimer) global.clearTimeout(restoreTimer);
        if (focusFrame) global.cancelAnimationFrame(focusFrame);
        restoreTimer = 0;
        focusFrame = 0;
        focusLayer?.classList.remove("is-active");
        focusLayer?.replaceChildren();
      }
    };
  }

  function bindPathFocus(options) {
    const root = options.root;
    const svg = options.svg;
    const selector = options.selector || ".flow-edge-wrap";
    const itemFor = options.itemFor;
    const controller = options.controller;
    const blockedSelector = options.blockedSelector || "";
    if (!root || !svg || !itemFor || !controller) return { destroy() {} };
    const cleanup = createCleanup();

    function edgeAt(event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      return Array.from(svg.querySelectorAll(selector)).find(edge => {
        const hit = edge.querySelector(".flow-edge-hit");
        return typeof hit?.isPointInStroke === "function" && hit.isPointInStroke(local);
      }) || null;
    }

    cleanup.listen(root, "pointermove", event => {
      if (blockedSelector && event.target instanceof Element && event.target.closest(blockedSelector)) {
        controller.clearPreview();
        return;
      }
      const edge = edgeAt(event);
      controller.preview(edge ? itemFor(edge) : null);
    });
    cleanup.listen(root, "pointerleave", () => controller.clearPreview());
    return { destroy: () => cleanup.destroy() };
  }

  global.FlowDiagramInteractions = { createHorizontalScrollRail, bindLayoutRefresh, createStableStateLayout, createRoundedSelect, createFocusLayer, createHitLayer, syncHitLayer, bindFocus, bindPathFocus, renderTransferLanes, renderTransferEdges, transferCellKey, validateTransferTopologies };
})(window);
