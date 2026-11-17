"use client";

import { useEffect, type RefObject } from "react";

const revealSelector = [
  ".collection > .section-eyebrow",
  ".eyebrow-wipe",
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
const magnetSelector = ".button, .hero-search button, .footer-search button";

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

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
      const letters = Array.from(
        root.querySelectorAll<HTMLElement>(".footer-letter"),
      );
      const logoSpark = wordmark?.querySelector<HTMLElement>(
        ".giant-spark .spark-icon",
      );
      const closing = root.querySelector<HTMLElement>(".closing-card");
      const ribbon = root.querySelector<HTMLElement>(".category-ribbon");
      const ribbonAnimation = ribbon
        ?.querySelector<HTMLElement>(".ribbon-track")
        ?.getAnimations?.()[0];
      const textScenes = Array.from(
        root.querySelectorAll<HTMLElement>("[data-scroll-text]"),
      ).map((element) => ({
        element,
        words: Array.from(
          element.querySelectorAll<HTMLElement>(".scroll-word"),
        ),
      }));
      const animations = new Set<Animation>();
      let scrollFrame = 0;
      let pointerFrame = 0;
      let ribbonFrame = 0;
      let pointerX = 0;
      let pointerY = 0;
      let pointerTarget: Element | null = null;
      let activeCard: HTMLElement | null = null;
      let activeMagnet: HTMLElement | null = null;
      let lettersNear = false;
      let logoCelebrated = false;
      let lastScrollY = window.scrollY;
      let lastScrollTime = performance.now();
      let ribbonBoost = 0;
      let ribbonRate = 1;
      const finePointer = window.matchMedia(
        "(hover: hover) and (pointer: fine)",
      );

      function track(animation: Animation) {
        animations.add(animation);
        animation.addEventListener(
          "finish",
          () => animations.delete(animation),
          { once: true },
        );
        if (document.hidden) animation.pause();
        return animation;
      }

      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(({ target, isIntersecting }) => {
            if (!isIntersecting) return;
            const element = target as HTMLElement;
            revealObserver.unobserve(element);
            const staggered = element.matches(
              ".template-card, .category-tile, .step, .benefit-strip > div",
            );
            const siblings = Array.from(element.parentElement?.children ?? []);
            const delay = staggered ? (siblings.indexOf(element) % 4) * 75 : 0;
            // CSS-only details (image curtain, label wipe) share the stagger.
            element.style.setProperty("--reveal-delay", `${delay}ms`);
            delete element.dataset.motionPending;
            element.dataset.motionSeen = "true";
            if (
              element.matches(".eyebrow-wipe") ||
              typeof element.animate !== "function"
            )
              return;

            track(
              element.animate(
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
              ),
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
            // Leave streamed category HTML untouched until React hydrates it.
            if (element.closest(".category-grid:not([data-hydrated])")) return;
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
      mutations.observe(root, {
        childList: true,
        subtree: true,
        attributeFilter: ["data-hydrated"],
      });
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

      /* Ribbon: scroll velocity speeds it up, reverses it and leans the type. */
      if (ribbonAnimation) {
        const duration = Number(ribbonAnimation.effect?.getTiming().duration);
        const time = ribbonAnimation.currentTime;
        // Whole iterations of headroom let it run backwards without finishing.
        ribbonAnimation.currentTime =
          (typeof time === "number" ? time : 0) +
          (duration > 0 ? duration : 32000) * 400;
      }
      function setRibbonRate(rate: number) {
        // A direct assignment keeps the current position and applies at once.
        if (ribbonAnimation) ribbonAnimation.playbackRate = rate;
      }
      function ribbonTick() {
        ribbonFrame = 0;
        ribbonBoost *= 0.9;
        ribbonRate += (1 + ribbonBoost - ribbonRate) * 0.16;
        const settled =
          Math.abs(ribbonRate - 1) < 0.02 && Math.abs(ribbonBoost) < 0.02;
        if (settled) {
          ribbonRate = 1;
          ribbonBoost = 0;
        }
        setRibbonRate(ribbonRate);
        ribbon?.style.setProperty(
          "--ribbon-skew",
          `${clamp((ribbonRate - 1) * 1.8, -9, 9).toFixed(2)}deg`,
        );
        if (!settled) ribbonFrame = requestAnimationFrame(ribbonTick);
      }

      /* Footer logo: a ripple of jumping, spinning letters plus lime sparks. */
      function burstLogo(origin: number) {
        letters.forEach((letter, index) => {
          const face = letter.querySelector<HTMLElement>(".footer-letter-face");
          if (!face || typeof face.animate !== "function") return;
          track(
            face.animate(
              [
                { transform: "translateY(0) rotateY(0deg) scale(1, 1)" },
                {
                  transform:
                    "translateY(0.02em) rotateY(0deg) scale(1.08, 0.86)",
                  offset: 0.16,
                },
                {
                  transform:
                    "translateY(-0.24em) rotateY(-180deg) scale(0.94, 1.08)",
                  offset: 0.5,
                },
                {
                  transform:
                    "translateY(0.015em) rotateY(-360deg) scale(1.05, 0.94)",
                  offset: 0.8,
                },
                { transform: "translateY(0) rotateY(-360deg) scale(1, 1)" },
              ],
              {
                duration: 980,
                delay: Math.abs(index - origin) * 70,
                easing: "cubic-bezier(.3, .7, .3, 1)",
              },
            ),
          );
        });
        if (logoSpark && typeof logoSpark.animate === "function") {
          track(
            logoSpark.animate(
              [
                { transform: "rotate(0deg) scale(1)" },
                { transform: "rotate(240deg) scale(1.7)", offset: 0.4 },
                { transform: "rotate(360deg) scale(1)" },
              ],
              { duration: 1100, easing: "cubic-bezier(.3, .7, .3, 1)" },
            ),
          );
        }
      }
      function sparkle(x: number, y: number) {
        if (!wordmark || typeof wordmark.animate !== "function") return;
        const count = 12;
        for (let index = 0; index < count; index++) {
          const particle = document.createElement("span");
          particle.className = `logo-particle${index % 3 === 0 ? " is-ring" : ""}`;
          particle.setAttribute("aria-hidden", "true");
          particle.style.left = `${x}px`;
          particle.style.top = `${y}px`;
          wordmark.append(particle);
          const angle =
            (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
          const distance = 70 + Math.random() * 110;
          const animation = particle.animate(
            [
              {
                transform: "translate(-50%, -50%) scale(1) rotate(0deg)",
                opacity: 1,
              },
              {
                transform: `translate(calc(-50% + ${Math.cos(angle) * distance}px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0) rotate(${180 + Math.random() * 180}deg)`,
                opacity: 0,
              },
            ],
            {
              duration: 650 + Math.random() * 450,
              easing: "cubic-bezier(.15, .8, .3, 1)",
            },
          );
          track(animation);
          animation.addEventListener("finish", () => particle.remove(), {
            once: true,
          });
          animation.addEventListener("cancel", () => particle.remove(), {
            once: true,
          });
        }
      }
      function onLogoClick(event: MouseEvent) {
        if (!wordmark) return;
        let origin = 0;
        let nearest = Infinity;
        letters.forEach((letter, index) => {
          const rect = letter.getBoundingClientRect();
          const distance = Math.abs(
            event.clientX - (rect.left + rect.width / 2),
          );
          if (distance < nearest) {
            nearest = distance;
            origin = index;
          }
        });
        burstLogo(origin);
        const rect = wordmark.getBoundingClientRect();
        sparkle(event.clientX - rect.left, event.clientY - rect.top);
      }
      wordmark?.addEventListener("click", onLogoClick);
      wordmark?.setAttribute("data-logo-interactive", "");

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
        const now = performance.now();
        const scrollDelta = window.scrollY - lastScrollY;
        const elapsed = Math.max(16, now - lastScrollTime);
        lastScrollY = window.scrollY;
        lastScrollTime = now;

        root!.style.setProperty(
          "--scroll-progress",
          String(available > 0 ? clamp(window.scrollY / available) : 0),
        );
        if (hero && window.scrollY < heroHeight) {
          hero.style.setProperty(
            "--hero-scroll",
            `${Math.min(window.scrollY * 0.045, 28)}px`,
          );
        }
        if (ribbonAnimation && scrollDelta !== 0) {
          ribbonBoost = clamp(
            ribbonBoost * 0.5 + (scrollDelta / elapsed) * 3.6,
            -6,
            8,
          );
          if (!ribbonFrame) ribbonFrame = requestAnimationFrame(ribbonTick);
        }
        if (wordmark && logoRect) {
          const unfold = clamp(
            (viewportHeight - logoRect.top) /
              Math.max(1, Math.min(logoRect.height, viewportHeight) * 1.3),
          );
          wordmark.style.setProperty("--logo-unfold", String(1 - unfold));
          // Liquid rises with the scroll and is full once the logo is in view.
          const fill = clamp(
            (viewportHeight - logoRect.top - logoRect.height * 0.1) /
              Math.max(1, logoRect.height * 0.85),
          );
          wordmark.style.setProperty("--logo-fill", fill.toFixed(4));
          wordmark.toggleAttribute("data-logo-full", fill >= 1);
          if (fill >= 1 && !logoCelebrated) {
            logoCelebrated = true;
            burstLogo(0);
          } else if (fill < 0.3) {
            logoCelebrated = false;
          }
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
      function resetMagnet() {
        activeMagnet?.style.removeProperty("--mag-x");
        activeMagnet?.style.removeProperty("--mag-y");
        activeMagnet = null;
      }
      function resetLetters() {
        if (!lettersNear) return;
        letters.forEach((letter) => letter.style.removeProperty("--near"));
        lettersNear = false;
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
          hero.style.setProperty("--spot-x", `${pointerX - rect.left}px`);
          hero.style.setProperty("--spot-y", `${pointerY - rect.top}px`);
          hero.dataset.spot = "true";
        } else if (hero) {
          hero.style.setProperty("--hero-x", "0px");
          hero.style.setProperty("--hero-y", "0px");
          delete hero.dataset.spot;
        }

        if (wordmark && pointerTarget && wordmark.contains(pointerTarget)) {
          const rect = wordmark.getBoundingClientRect();
          wordmark.style.setProperty(
            "--logo-light-x",
            `${clamp((pointerX - rect.left) / rect.width) * 100}%`,
          );
          wordmark.style.setProperty(
            "--logo-light-y",
            `${clamp((pointerY - rect.top) / rect.height) * 100}%`,
          );
          // Letters near the pointer lift and stretch like keys being pulled.
          const letterRects = letters.map((letter) =>
            letter.getBoundingClientRect(),
          );
          letters.forEach((letter, index) => {
            const letterRect = letterRects[index];
            const distance =
              (pointerX - (letterRect.left + letterRect.width / 2)) /
              Math.max(1, letterRect.width * 1.4);
            const near = clamp(1 - distance * distance);
            letter.style.setProperty("--near", (near * near).toFixed(3));
          });
          lettersNear = true;
        } else {
          resetLetters();
        }

        const magnet =
          pointerTarget?.closest<HTMLElement>(magnetSelector) ?? null;
        if (magnet !== activeMagnet) resetMagnet();
        if (magnet) {
          activeMagnet = magnet;
          const rect = magnet.getBoundingClientRect();
          const x = (pointerX - (rect.left + rect.width / 2)) * 0.3;
          const y = (pointerY - (rect.top + rect.height / 2)) * 0.4;
          magnet.style.setProperty("--mag-x", `${clamp(x, -10, 10)}px`);
          magnet.style.setProperty("--mag-y", `${clamp(y, -7, 7)}px`);
        }

        const card =
          pointerTarget?.closest<HTMLElement>(
            ".template-card, .category-tile",
          ) ?? null;
        if (card !== activeCard) resetCard();
        if (!card) return;
        activeCard = card;
        const rect = card.getBoundingClientRect();
        const x = clamp((pointerX - rect.left) / rect.width);
        const y = clamp((pointerY - rect.top) / rect.height);
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
        resetMagnet();
        resetLetters();
        hero?.style.setProperty("--hero-x", "0px");
        hero?.style.setProperty("--hero-y", "0px");
        if (hero) delete hero.dataset.spot;
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
        cancelAnimationFrame(ribbonFrame);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        root!.removeEventListener("pointermove", onPointerMove);
        root!.removeEventListener("pointerleave", onPointerLeave);
        wordmark?.removeEventListener("click", onLogoClick);
        document.removeEventListener("visibilitychange", onVisibility);
        onPointerLeave();
        setRibbonRate(1);
        ribbon?.style.removeProperty("--ribbon-skew");
        root!
          .querySelectorAll("[data-motion-pending], [data-motion-offscreen]")
          .forEach((element) => {
            element.removeAttribute("data-motion-pending");
            element.removeAttribute("data-motion-offscreen");
          });
        root!.style.removeProperty("--scroll-progress");
        ["--hero-scroll", "--spot-x", "--spot-y"].forEach((name) =>
          hero?.style.removeProperty(name),
        );
        [
          "--logo-unfold",
          "--logo-fill",
          "--logo-light-x",
          "--logo-light-y",
        ].forEach((name) => wordmark?.style.removeProperty(name));
        wordmark?.removeAttribute("data-logo-full");
        wordmark?.removeAttribute("data-logo-interactive");
        wordmark
          ?.querySelectorAll(".logo-particle")
          .forEach((particle) => particle.remove());
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
