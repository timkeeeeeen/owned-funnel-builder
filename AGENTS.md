# Agent instructions

The owner may have no computer skills. Work from their business language and handle repository, service, and deployment operations on their behalf.

## Start here

1. Read `PROJECT.md`.
2. Read the relevant skill under `skills/`.
3. Read only the design primitives under `system/globals/` that apply to the current change.
4. Inspect the existing offer and shared components before creating new structure.

## How to collaborate

Ask about the offer, buyer, price, deliverables, proof, objections, guarantee, and access link in plain language. Do not ask the owner to use Git, a terminal, YAML, environment variables, bindings, migrations, or product IDs.

Open Keystatic when the owner wants to hand-edit copy. Use the local setup screen for secrets. Describe browser authorization as connecting the named service.

Treat the agent as capable. Use the provided context and checks; do not blindly reproduce an old page or force every offer into the same section order.

## Design

Use the existing visual system as the default. Preserve strong hierarchy, large clear actions, readable measure, intentional spacing, real previews, and mobile recomposition.

You may customize tokens, add components, and write original Astro. Keep shared payment and accessibility behavior centralized unless there is a concrete reason to extend it.

Never use reference-site names, screenshots, copy, assets, or provenance in product output. Never invent proof.

## Payments and email

Follow the invariants in `PROJECT.md`. Never commit or print credentials. Do not pass secrets as command arguments. Dodo is supported; do not claim Stripe parity without equivalent implementation and tests.

Do not place a live order without explicit approval. Test-mode orders are allowed when the owner asks to connect or verify payments.

## Safety and GitHub

Preserve unrelated work and the known-good funnel tag. Use focused commits and push coherent, passing milestones when the owner has asked for GitHub backup.

Do not publish, create paid products, or mutate external services unless the owner asked to connect or launch them. Previewing, validating, and explaining are safe by default.

## Done

A change is done when the relevant build, function, content, visual, payment, and deployment checks pass in proportion to its risk. Give the owner the public URL only when it is actually deployed and verified.
