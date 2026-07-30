# Five App Blueprints

## 1. Client portal

Core nouns: workspace, client, request, deliverable, approval. First slice: a client submits a request, the team responds, and the client approves or requests changes. Prove tenant isolation and the full empty-to-approved path.

## 2. Launch tracker

Core nouns: launch, milestone, owner, blocker, evidence. First slice: create a launch, add milestones, mark a blocker, attach proof, and show readiness. Prove dates, ownership, and status transitions.

## 3. AI research workspace

Core nouns: project, source, claim, finding, citation. First slice: add a source, extract findings, connect every claim to evidence, and export a brief. Keep generated text clearly distinguished from source truth.

## 4. Approval and operations app

Core nouns: request, policy, reviewer, decision, audit event. First slice: submit a request, route it to the correct reviewer, record approve/reject, and preserve an immutable event trail.

## 5. Vertical SaaS starter

Core nouns: workspace plus the buyer’s primary record. First slice: create, view, update, list, export, and delete or archive that record according to an explicit retention policy.

## Agent brief

> Build blueprint [number] for [buyer]. Rename the nouns to [domain nouns]. Start with one workspace-owned end-to-end slice. Use the existing shell and typed contracts. Include loading, empty, error, detail, create, and success states. Keep live providers fake-safe until I approve credentials. Prove tenant isolation, the key state transition, and the real built route.

