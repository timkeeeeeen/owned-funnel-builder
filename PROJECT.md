# PROJECT.md — Maestro Offers

## Purpose

This repository produces fast, conversion-focused landing pages for low-ticket Maestro offers. Every paid traffic destination must make one promise, present one offer, and drive one primary action.

## Runtime

- Use Astro 7.1.6 or newer. The Astro 6 version references inherited from upstream AstroDeck documentation are historical for this fork and do not override the patched project runtime.

## Design direction

- Use a spare, high-contrast editorial layout inspired by direct-response pages: oversized headlines, wide buttons, clear section rhythm, and repeated CTAs.
- Geist is the primary typeface. Use Geist Mono only for labels, steps, and technical proof.
- Electric cobalt is the action color. Warm yellow is reserved for highlights, bonuses, and guarantees.
- Keep the first viewport focused on the promise, product, price, and CTA. Avoid navigation menus and decorative distractions.
- Use CSS shapes and real product facts. Do not add stock photography, invented testimonials, fake logos, or vanity metrics.

## Voice

- Direct, specific, confident, and slightly irreverent.
- Short sentences. Concrete nouns. Product truth over generic AI claims.
- Explain technical features as saved time, avoided rework, or a safer path to shipping.
- Never imply that fake-safe provider adapters are already connected live.

## Offer rules

- One offer per route.
- Every route needs a unique title, meta description, social image, price, guarantee, FAQ, and checkout URL.
- Repeat the primary CTA after the hero, outcomes, price, and final close.
- Preserve campaign parameters when the checkout URL is an HTTP URL.
- New offers are created as JSON files in `src/data/offers/`; page rendering stays shared.
- Confirm the real checkout URL, price, guarantee, and delivery method before sending paid traffic.
