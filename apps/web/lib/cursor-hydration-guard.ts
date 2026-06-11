export function removeCursorHydrationRefs(root: Document): void {
  root
    .querySelectorAll("[data-cursor-ref]")
    .forEach((element) => element.removeAttribute("data-cursor-ref"));
}

export const cursorHydrationGuardScript = `
(() => {
  const removeCursorHydrationRefs = () => {
    document
      .querySelectorAll("[data-cursor-ref]")
      .forEach((element) => element.removeAttribute("data-cursor-ref"));
  };

  removeCursorHydrationRefs();

  const observer = new MutationObserver(removeCursorHydrationRefs);
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-cursor-ref"],
  });

  window.addEventListener("load", () => {
    removeCursorHydrationRefs();
    window.setTimeout(() => observer.disconnect(), 2000);
  });
})();
`;
