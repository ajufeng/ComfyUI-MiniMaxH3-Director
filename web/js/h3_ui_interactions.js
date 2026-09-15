export function nextH3CanvasScale(currentScale, delta, minScale = 0.1, maxScale = 10) {
  const current = Number(currentScale) || 1;
  const lower = Number.isFinite(Number(minScale)) ? Number(minScale) : 0.1;
  const upper = Number.isFinite(Number(maxScale)) ? Number(maxScale) : 10;
  if (!Number(delta)) return Math.min(upper, Math.max(lower, current));
  const next = current * (delta < 0 ? 1.1 : 1 / 1.1);
  return Math.min(upper, Math.max(lower, next));
}

export function h3CanvasOffsetAtPoint(offset, oldScale, newScale, point) {
  const current = Array.isArray(offset) ? offset : [0, 0];
  const before = Number(oldScale) || 1;
  const after = Number(newScale) || before;
  const anchor = Array.isArray(point) ? point : [0, 0];
  return [
    Number(current[0] || 0) + Number(anchor[0] || 0) / after - Number(anchor[0] || 0) / before,
    Number(current[1] || 0) + Number(anchor[1] || 0) / after - Number(anchor[1] || 0) / before,
  ];
}

export function h3CanvasOffsetAfterPan(offset, deltaX, deltaY, scale) {
  const current = Array.isArray(offset) ? offset : [0, 0];
  const rawScale = Number(scale);
  const canvasScale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  return [
    Number(current[0] || 0) + Number(deltaX || 0) / canvasScale,
    Number(current[1] || 0) + Number(deltaY || 0) / canvasScale,
  ];
}

function h3NativeWheelControl(element) {
  const tag = String(element && element.tagName || "").toUpperCase();
  if (tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return ["number", "range"].includes(String(element.type || "").toLowerCase());
}

function h3ElementCanScroll(element, deltaX, deltaY, getStyle) {
  let style;
  try {
    style = getStyle(element);
  } catch (error) {
    return false;
  }
  const overflowY = String(style && style.overflowY || "");
  const overflowX = String(style && style.overflowX || "");
  const vertical = /^(?:auto|scroll|overlay)$/.test(overflowY)
    && Number(element.scrollHeight || 0) > Number(element.clientHeight || 0) + 1;
  const horizontal = /^(?:auto|scroll|overlay)$/.test(overflowX)
    && Number(element.scrollWidth || 0) > Number(element.clientWidth || 0) + 1;

  if (Math.abs(Number(deltaX || 0)) > Math.abs(Number(deltaY || 0)) && horizontal) {
    if (deltaX < 0) return Number(element.scrollLeft || 0) > 1;
    if (deltaX > 0) {
      return Number(element.scrollLeft || 0) + Number(element.clientWidth || 0)
        < Number(element.scrollWidth || 0) - 1;
    }
  }
  if (vertical) {
    if (deltaY < 0) return Number(element.scrollTop || 0) > 1;
    if (deltaY > 0) {
      return Number(element.scrollTop || 0) + Number(element.clientHeight || 0)
        < Number(element.scrollHeight || 0) - 1;
    }
  }
  return false;
}

export function findH3WheelOwner(
  target, root, deltaX, deltaY,
  getStyle = (element) => globalThis.getComputedStyle(element),
) {
  let element = target;
  while (element) {
    if (h3NativeWheelControl(element)) return element;
    if (typeof getStyle === "function" && h3ElementCanScroll(element, deltaX, deltaY, getStyle)) {
      return element;
    }
    if (element === root) break;
    element = element.parentElement;
  }
  return null;
}
