"use client";

import { useEffect, type RefObject } from "react";

const revealSelector = [
  ".collection > .section-eyebrow",
  ".section-heading-row",
  ".collection-toolbar",
  ".template-card",
  ".category-tile",
  ".how-intro",
  ".step",
  ".benefit-strip > div",
  ".creator-copy",
  ".creator-visual",
  ".closing-card",
  ".footer-top",
].join(",");

/** Progressive enhancement: the server-rendered page stays visible without JS. */
export function useLandingMotion(
  rootRef: RefObject<HTMLDivElement | null>,
  paused: boolean,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");

    function enhance() {
      if (!root || paused || preference.matches) return () => {};

      const hero = root.querySelector<HTMLElement>(".hero");
      const wordmark = root.querySelector<HTMLElement>(".giant-wordmark");
      const closing = root.querySelector<HTMLElement>(".closing-card");
      const textScenes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-scroll-text]"),
      ).map((element) => ({
        element,
        words: Array.from(
          element.querySelectorAll<HTMLElement>(".scroll-word"),
        ),
      }));
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const animations = new Set<Animation>();
      let scrollFrame = 0;
      let pointerFrame = 0;
      let pointerX = 0;
      let pointerY = 0;
      let pointerTarget: Element | null = null;
      let activeCard: HTMLElement | null = null;
      const finePointer = window.matchMedia(
        "(hover: hover) and (pointer: fine)",
      );

      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            if (!isIntersecting) return;
            const element = target as HTMLElement;
            revealObserver.unobserve(element);
            delete element.dataset.motionPending;
            element.dataset.motionSeen = "true";
            if (typeof element.animate !== "function") return;

            const staggered = element.matches(
              ".template-card, .category-tile, .step, .benefit-strip > div",
            );
            const siblings = Array.from(element.parentElement?.children ?? []);
            const delay = staggered ? (siblings.indexOf(element) % 4) * 75 : 0;
            const animation = element.animate(
              [
                { opacity: 0, translate: "0 28px" },
                { opacity: 1, translate: "0 0" },
              ],
              {
                duration: 760,
                delay,
                easing: "cubic-bezier(.16, 1, .3, 1)",
                fill: "backwards",
              },
            );
            animations.add(animation);
            animation.addEventListener(
              "finish",
              () => animations.delete(animation),
              { once: true },
            );
          });
        },
        { threshold: 0.06, rootMargin: "0px 0px -24px 0px" },
      );

      function registerReveals() {
        root!
          .querySelectorAll<HTMLElement>(revealSelector)
          .forEach((element) => {
            if (element.dataset.motionSeen || element.dataset.motionPending)
              return;
            if (element.getBoundingClientRect().bottom <= 0) {
              element.dataset.motionSeen = "true";
              return;
            }
            element.dataset.motionPending = "true";
            revealObserver.observe(element);
          });
      }

      // Newly filtered cards and streamed API categories also receive an entrance.
      const mutations = new MutationObserver((records) => {
        records.forEach((record) =>
          record.removedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            revealObserver.unobserve(node);
            node
              .querySelectorAll(revealSelector)
              .forEach((element) => revealObserver.unobserve(element));
          }),
        );
        registerReveals();
      });
      mutations.observe(root, { childList: true, subtree: true });
      registerReveals();

      const ambientObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            (target as HTMLElement).toggleAttribute(
              "data-motion-offscreen",
              !isIntersecting,
            );
          });
        },
        { rootMargin: "120px" },
      );
      root
        .querySelectorAll(
          ".hero, .category-ribbon, .creator-section, .closing-section, .site-footer",
        )
        .forEach((element) => ambientObserver.observe(element));

      function updateScroll() {
        scrollFrame = 0;
        const viewportHeight = window.innerHeight;
        // Measure before writing so scroll effects don't force repeated layout.
        const logoRect = wordmark?.getBoundingClientRect();
        const closingRect = closing?.parentElement?.getBoundingClientRect();
        const headingRects = textScenes.map(({ element }) =>
          element.getBoundingClientRect(),
        );
        const available =
          document.documentElement.scrollHeight - viewportHeight;
        const heroHeight = hero?.offsetHeight ?? 0;
        root!.style.setProperty(
          "--scroll-progress",
          String(
            available > 0
              ? Math.min(1, Math.max(0, window.scrollY / available))
              : 0,
          ),
        );
        if (hero && window.scrollY < heroHeight) {
          hero.style.setProperty(
            "--hero-scroll",
            `${Math.min(window.scrollY * 0.045, 28)}px`,
          );
        }
        if (wordmark && logoRect) {
          const progress = clamp(
            (viewportHeight - logoRect.top) /
              Math.max(1, Math.min(logoRect.height, viewportHeight) * 1.3),
          );
          wordmark.style.setProperty("--logo-unfold", String(1 - progress));
        }
        if (closing && closingRect) {
          const progress = clamp(
            (viewportHeight - closingRect.top) /
              Math.max(1, Math.min(closingRect.height, viewportHeight) * 0.85),
          );
          closing.style.setProperty(
            "--closing-scale",
            String(0.94 + progress * 0.06),
          );
          closing.style.setProperty(
            "--closing-lift",
            `${(1 - progress) * 24}px`,
          );
          closing.style.setProperty(
            "--closing-turn",
            `${(1 - progress) * -20}deg`,
          );
        }
        textScenes.forEach(({ words }, sceneIndex) => {
          const rect = headingRects[sceneIndex];
          const progress = clamp(
            (viewportHeight * 0.88 - rect.top) /
              Math.max(1, Math.min(viewportHeight * 0.32, rect.height + 100)),
          );
          words.forEach((word, index) => {
            const reveal = clamp(
              progress * 1.65 - (index / Math.max(1, words.length - 1)) * 0.65,
            );
            word.style.setProperty("--word-reveal", String(reveal));
          });
        });
      }
      function onScroll() {
        if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScroll);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll, { passive: true });
      updateScroll();

      function resetCard() {
        activeCard?.style.removeProperty("--tilt-x");
        activeCard?.style.removeProperty("--tilt-y");
        activeCard?.style.removeProperty("--shine-x");
        activeCard?.style.removeProperty("--shine-y");
        activeCard = null;
      }
      function updatePointer() {
        pointerFrame = 0;
        if (hero && pointerTarget && hero.contains(pointerTarget)) {
          const rect = hero.getBoundingClientRect();
          hero.style.setProperty(
            "--hero-x",
            `${(pointerX / rect.width - 0.5) * 14}px`,
          );
          hero.style.setProperty(
            "--hero-y",
            `${((pointerY - rect.top) / rect.height - 0.5) * 8}px`,
          );
        } else if (hero) {
          hero.style.setProperty("--hero-x", "0px");
          hero.style.setProperty("--hero-y", "0px");
        }
        if (wordmark) {
          if (pointerTarget && wordmark.contains(pointerTarget)) {
            const rect = wordmark.getBoundingClientRect();
            const x = clamp((pointerX - rect.left) / rect.width);
            const y = clamp((pointerY - rect.top) / rect.height);
            wordmark.style.setProperty("--logo-x", `${(x - 0.5) * 10}px`);
            wordmark.style.setProperty("--logo-y", `${(y - 0.5) * 6}px`);
            wordmark.style.setProperty("--logo-tilt", `${(x - 0.5) * 3}deg`);
            wordmark.style.setProperty("--logo-light-x", `${x * 100}%`);
            wordmark.style.setProperty("--logo-light-y", `${y * 100}%`);
          } else {
            ["--logo-x", "--logo-y", "--logo-tilt"].forEach((name) =>
              wordmark.style.removeProperty(name),
            );
          }
        }
        const card =
          pointerTarget?.closest<HTMLElement>(
            ".template-card, .category-tile",
          ) ?? null;
        if (card !== activeCard) resetCard();
        if (!card) return;
        activeCard = card;
        const rect = card.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (pointerX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (pointerY - rect.top) / rect.height));
        card.style.setProperty("--tilt-x", `${(0.5 - y) * 5}deg`);
        card.style.setProperty("--tilt-y", `${(x - 0.5) * 6}deg`);
        card.style.setProperty("--shine-x", `${x * 100}%`);
        card.style.setProperty("--shine-y", `${y * 100}%`);
      }
      function onPointerMove(event: PointerEvent) {
        if (!finePointer.matches || event.pointerType === "touch") return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        pointerTarget = event.target instanceof Element ? event.target : null;
        if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointer);
      }
      function onPointerLeave() {
        if (pointerFrame) cancelAnimationFrame(pointerFrame);
        pointerFrame = 0;
        pointerTarget = null;
        resetCard();
        hero?.style.setProperty("--hero-x", "0px");
        hero?.style.setProperty("--hero-y", "0px");
        ["--logo-x", "--logo-y", "--logo-tilt"].forEach((name) =>
          wordmark?.style.removeProperty(name),
        );
      }
      root.addEventListener("pointermove", onPointerMove, { passive: true });
      root.addEventListener("pointerleave", onPointerLeave);

      function onVisibility() {
        root!.toggleAttribute("data-page-hidden", document.hidden);
        animations.forEach((animation) =>
          document.hidden ? animation.pause() : animation.play(),
        );
      }
      document.addEventListener("visibilitychange", onVisibility);
      onVisibility();

      return () => {
        revealObserver.disconnect();
        ambientObserver.disconnect();
        mutations.disconnect();
        animations.forEach((animation) => animation.cancel());
        cancelAnimationFrame(scrollFrame);
        cancelAnimationFrame(pointerFrame);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        root!.removeEventListener("pointermove", onPointerMove);
        root!.removeEventListener("pointerleave", onPointerLeave);
        document.removeEventListener("visibilitychange", onVisibility);
        onPointerLeave();
        root!
          .querySelectorAll("[data-motion-pending], [data-motion-offscreen]")
          .forEach((element) => {
            element.removeAttribute("data-motion-pending");
            element.removeAttribute("data-motion-offscreen");
          });
        root!.style.removeProperty("--scroll-progress");
        hero?.style.removeProperty("--hero-scroll");
        ["--logo-unfold", "--logo-light-x", "--logo-light-y"].forEach((name) =>
          wordmark?.style.removeProperty(name),
        );
        ["--closing-scale", "--closing-lift", "--closing-turn"].forEach(
          (name) => closing?.style.removeProperty(name),
        );
        textScenes.forEach(({ words }) =>
          words.forEach((word) => word.style.removeProperty("--word-reveal")),
        );
        root!.removeAttribute("data-page-hidden");
      };
    }

    let cleanup = enhance();
    function onPreferenceChange() {
      cleanup();
      cleanup = enhance();
    }
    preference.addEventListener("change", onPreferenceChange);
    return () => {
      cleanup();
      preference.removeEventListener("change", onPreferenceChange);
    };
  }, [rootRef, paused]);
}
