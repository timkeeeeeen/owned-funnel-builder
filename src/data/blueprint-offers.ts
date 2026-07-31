export const BLUEPRINT_AUDIENCE_SLUGS = [
  'agency-owners',
  'consultants',
  'coaches',
  'solo-experts',
] as const;

export type BlueprintAudienceSlug = (typeof BLUEPRINT_AUDIENCE_SLUGS)[number];

export interface BlueprintAudienceCopy {
  slug: BlueprintAudienceSlug;
  singular: string;
  plural: string;
  switchLabel: string;
  snapshotHeadline: string;
  snapshotSubheadline: string;
  gamePlanHeadline: string;
  gamePlanSubheadline: string;
  costlyPattern: string;
  desiredShift: string;
  exampleContext: string;
  exampleObjective: string;
  exampleFinding: string;
  exampleEvidence: readonly [string, string, string, string, string];
  examplePriorities: readonly [string, string, string];
  exampleSlots: readonly string[];
  exampleQuestions: readonly [string, string, string];
  examplePostTitle: string;
  examplePostBody: string;
}

export const blueprintProductContract = {
  status: 'acceptance-preview',
  previewNotice:
    'This private preview shows the finished offer and example output. Submissions and checkout are not open yet.',
  supportEmail: 'tim@modernagencysales.com',
  sharedProductKey: 'cmo-game-plan',
  commercialTerms: {
    delivery:
      'After payment and email-verified sign-in, the five-chapter audit opens immediately. The score and 20-slot plan appear after all five answers are evaluated. Your Snapshot remains Post 1 and four additional drafts appear progressively as generation completes.',
    includedRevision:
      'One resumable Content Working Session is included. It uses new stories or proof to repair only the affected first-five drafts. Further copy edits remain available through the included light editor; unlimited done-for-you rewrites are not included.',
    support:
      'Email support is available at tim@modernagencysales.com, with a target response within two business days.',
    refund:
      'Request a refund within seven calendar days if you cannot access the paid product or the core score, plan, and five-draft package still cannot be produced after support has had a reasonable opportunity to retry the failed stage. A preferred business outcome or subjective copy preference is not guaranteed once the deliverables are accessible. This does not limit non-excludable legal rights.',
    retainedAccess:
      'Claimed paid artifacts remain available in your Maestro workspace without Blueprint Activation and can be exported at any time. Expiring session and email links control secure access; they do not silently delete the underlying result. Product data is retained until you request deletion, close the account, or the service is retired, subject to records we must keep for fraud prevention, accounting, or law.',
  },
  authoritySnapshot: {
    name: 'Authority Snapshot',
    scoreName: 'Visible Authority Score',
    priceLabel: 'Free',
    scoreMaximum: 40,
    dimensionCount: 2,
    criterionCount: 8,
    criterionMaximum: 5,
    dimensions: [
      {
        label: 'Profile Visibility',
        criteria: [
          'Target-buyer clarity',
          'Outcome or value-promise clarity',
          'Visible and usable proof',
          'Clarity of the next action',
        ],
      },
      {
        label: 'Content Visibility',
        criteria: [
          'Visible recent consistency',
          'Recognizable point of view',
          'Specificity, stories, or evidence',
          'Connection to a relevant commercial next step',
        ],
      },
    ],
    unassessedSystemDimensions: ['Outreach', 'Lead capture', 'Proof'],
    instrumentBoundary:
      'This is what a buyer can see. It does not score the systems behind your profile.',
    maximumFindings: 3,
    draftCount: 1,
    ctaLabel: 'Run my free Authority Snapshot',
    ctaNote:
      'Uses your public LinkedIn evidence. Nothing is published. Your saved result can be resumed.',
    form: {
      linkedinLabel: 'LinkedIn profile URL',
      linkedinPlaceholder: 'https://linkedin.com/in/you',
      emailLabel: 'Work email for your saved result',
      emailPlaceholder: 'you@company.com',
      consent:
        'We use your email to deliver and recover this result. Product updates are optional and must be consented to separately.',
    },
  },
  gamePlan: {
    name: '$5 CMO Game Plan',
    scoreName: 'Authority System Score',
    priceAmount: 5,
    currency: 'USD',
    scoreMaximum: 100,
    dimensionCount: 5,
    criterionCount: 20,
    priorityCount: 3,
    weekCount: 4,
    slotCount: 20,
    retainedDraftCount: 5,
    criterionMaximum: 5,
    scoreScale: [
      '0 — explicitly absent',
      '1 — vague, aspirational, or isolated',
      '2 — ad hoc activity with incomplete execution',
      '3 — clear repeatable practice operating',
      '4 — measured and regularly improved',
      '5 — integrated with recent evidence of consistent outcomes',
    ],
    completionRules: [
      'Unknown, skipped, or unavailable evidence is unassessed, not zero.',
      '“None” or “not tracked” can be complete evidence for a low score.',
      'No total out of 100 is shown until every criterion has complete evidence.',
      'The preserved Visible Authority Score is a separate instrument and is never added to this score.',
    ],
    dimensions: [
      {
        label: 'Profile',
        criteria: ['Buyer', 'Promise', 'Proof', 'Action'],
      },
      {
        label: 'Content',
        criteria: ['Consistency', 'Source system', 'Response', 'Learning loop'],
      },
      {
        label: 'Outreach',
        criteria: ['Targeting', 'Activity', 'Follow-up', 'Measurement'],
      },
      {
        label: 'Lead capture',
        criteria: ['Offer', 'Capture', 'Nurture', 'Conversion'],
      },
      {
        label: 'Proof',
        criteria: ['Inventory', 'Documentation', 'Deployment', 'Freshness and permission'],
      },
    ],
    ctaLabel: 'Get my full Game Plan — $5',
    ctaNote: 'One payment. No subscription. No content is auto-published.',
    auditExpectation:
      'About 10 minutes · five short chapters · type your answers · no subscription or sales call.',
    snapshotBridgeContinuity: 'Your Snapshot draft becomes Post 1; the Game Plan adds four more.',
    directContinuity: 'If you already completed a Snapshot, that draft is retained as Post 1.',
    ownedAccess: ['Resume', 'Read', 'Copy', 'Light edit', 'Plain-text export'],
    workingSession:
      'Continue with the same AI CMO for about 12 minutes by text, or voice where available, to add stories and proof and repair only the affected drafts.',
  },
  activation: {
    name: 'Blueprint Activation',
    optional: true,
    amountMinor: 9_900,
    currency: 'USD',
    cadence: 'monthly',
    firstInvoiceCreditMinor: 500,
    remainingPostCount: 15,
    profileRewriteIncluded: true,
    leadMagnetConceptCount: 3,
    description:
      'Optional implementation after the $5 deliverable: finish the remaining 15 posts, profile rewrite, and three lead-magnet concepts inside Maestro with ongoing CMO access.',
  },
  proof: [
    {
      value: '7 figures',
      label: 'agency exit',
      detail: 'Tim sold his agency in October 2022.',
    },
    {
      value: '$300K/mo',
      label: 'at exit',
      detail: 'The agency was operating at roughly $300K per month.',
    },
    {
      value: '100%',
      label: 'LinkedIn-led',
      detail: 'Tim says the agency acquisition engine was entirely LinkedIn-led.',
    },
    {
      value: '300+',
      label: 'agencies helped',
      detail: 'Across Tim’s earlier agency programs and advisory work.',
    },
  ],
  testimonials: [
    {
      quote:
        'Over the course of the program with Tim I doubled revenue in about two months. Simple details and tips that were actionable, easy to understand and broke our limiting beliefs.',
      author: 'Alexandre Olim',
      role: 'Co-Founder, Plutus Media',
    },
    {
      quote:
        'Since taking the course, LinkedIn has become a lead gen source for us, which was nothing before.',
      author: 'Chirag Kulkarni',
      role: 'Founder, Taco Digital',
    },
    {
      quote:
        'Almost too booked actually at the moment, with loads of leads coming in through my LinkedIn directly.',
      author: 'Jessie Healy',
      role: 'CMO, Webtopia',
    },
  ],
  proofDisclaimer:
    'These are results and credentials from Tim’s earlier agency programs. They establish relevant experience; they are not results from the new Authority Snapshot or $5 CMO Game Plan, and no similar outcome is promised.',
  qualityRules: [
    'Every recommendation points to evidence from the buyer’s profile, public content, or explicit audit answers.',
    'The plan ranks three moves instead of returning a generic list of marketing advice.',
    'Every slot has a job, a buyer, a source, and a reason it belongs in this month.',
    'Unknown facts become visible questions. The CMO never invents proof, clients, numbers, or stories.',
    'Drafts are labeled Ready or Strong starter, with the remaining source questions shown.',
    'The buyer keeps the paid score, plan, session summary, and first five drafts without activating.',
  ],
  launchGates: [
    'A safe LinkedIn-unavailable path is tested; no arbitrary URL can be fetched.',
    'The free result has durable storage, an opaque resume route, recovery email, and a defined retention policy.',
    'The paid intake collects buyer, offer, proof, objective, pipeline reality, and source stories before drafting.',
    'Human review proves five useful retained drafts per audience after the included Working Session; blocked drafts cannot count as complete.',
    'Every paid artifact can be resumed and exported after the buyer declines Blueprint Activation.',
    'Delivery timing, refund terms, revision limits, and support expectations are decided and shown consistently.',
    'Every proof claim and testimonial has source evidence and permission for landing-page and paid-ad use.',
    'A no-charge canary and Dodo test-mode purchase prove both acquisition paths against the current product contract.',
  ],
  illustrativeSample: {
    label: 'Illustrative product example',
    note: 'Example only. The scenario, observations, titles, and drafts below are synthetic, not customer results or testimonials.',
    snapshotScore: 25,
    snapshotDimensions: [
      { label: 'Profile Visibility', score: 14, maximum: 20 },
      { label: 'Content Visibility', score: 11, maximum: 20 },
    ],
    paidScore: 63,
    paidDimensions: [
      { label: 'Profile', score: 12, maximum: 20 },
      { label: 'Content', score: 13, maximum: 20 },
      { label: 'Outreach', score: 11, maximum: 20 },
      { label: 'Lead capture', score: 14, maximum: 20 },
      { label: 'Proof', score: 13, maximum: 20 },
    ],
  },
} as const;

export const blueprintAudiences: Record<BlueprintAudienceSlug, BlueprintAudienceCopy> = {
  'agency-owners': {
    slug: 'agency-owners',
    singular: 'agency owner',
    plural: 'agency owners',
    switchLabel: 'Agency owners',
    snapshotHeadline: 'See whether your LinkedIn makes your agency the obvious choice.',
    snapshotSubheadline:
      'We read the public evidence a prospect sees, score what is actually visible, and show where strong client work is getting lost in generic agency language.',
    gamePlanHeadline: 'A prioritized 30-day LinkedIn plan built from your agency’s evidence.',
    gamePlanSubheadline:
      'Give a personal AI CMO your profile, proof, offer, and pipeline reality. Get three ranked priorities, a 20-slot month, and your first five drafts for $5.',
    costlyPattern:
      'The best proof is trapped in delivery calls and case-study folders while the public feed sounds like every other capable agency.',
    desiredShift:
      'Make your point of view, client evidence, and buying path visible before the next sales call.',
    exampleContext:
      'A performance agency with strong retention, inconsistent founder-led pipeline, and broad positioning.',
    exampleObjective:
      'Turn delivery proof into a sharper point of view that starts conversations with the accounts the agency already serves best.',
    exampleFinding:
      'The profile names services but never tells an ideal buyer why this agency sees the problem differently.',
    exampleEvidence: [
      'The headline lists paid media, email, and CRO but names no best-fit market or commercial result.',
      'Nine of the last twelve posts give broad advice; only one explains a decision made for a client.',
      'The founder says referrals still create most qualified conversations and outbound happens in bursts.',
      'There is a booking link, but no visible diagnostic or low-friction reason for the right buyer to use it.',
      'Two retained-client examples contain strong numbers, but neither appears in the profile or recent content.',
    ],
    examplePriorities: [
      'Narrow the public claim around the client result the agency can already prove.',
      'Turn delivery decisions and case-study moments into visible operating judgment.',
      'Give every week one deliberate bridge from useful post to qualified conversation.',
    ],
    exampleSlots: [
      'The expensive reason “full service” positioning stalls',
      'What a 90-day retention win changed in our process',
      'The audit question we ask before touching ad spend',
      'Why more leads will not fix a weak handoff',
      'A quiet invitation for teams reviewing their pipeline',
      'The dashboard metric we deliberately ignored for a client',
      'What we stopped doing after a losing quarter',
      'Three signs creative is not the real bottleneck',
      'How we decide when not to scale spend',
      'Inside the weekly account review that protects retention',
      'Why your best channel can hide weak economics',
      'The funnel stage most agencies optimize too late',
      'A teardown of polite but useless reporting',
      'What procurement needs before performance promises',
      'The trade-off behind our narrowest offer',
      'Who gets the fastest win in our first 30 days',
      'Before hiring another SDR, check this handoff',
      'The client objection that improved our process',
      'The problem we are not the right agency to solve',
      'An invitation to pressure-test your pipeline',
    ],
    exampleQuestions: [
      'Which retained-client result can we name publicly, and what decision produced it?',
      'Which account type reaches value fastest in the first 30 days?',
      'What is one prospect objection you hear often enough to answer with evidence?',
    ],
    examplePostTitle: 'The proof most agencies never publish',
    examplePostBody:
      'Most agencies publish the result and hide the decision that produced it.\n\nA verified performance result is evidence. But the useful authority is the call behind it: what you stopped, what you kept, and what you saw before the dashboard caught up.\n\nThat judgment is the part the next buyer needs to see.\n\nThis month, document one decision behind every result you are allowed to share. If the number or client cannot be named, leave a visible source question instead of inventing specificity.',
  },
  consultants: {
    slug: 'consultants',
    singular: 'consultant',
    plural: 'consultants',
    switchLabel: 'Consultants',
    snapshotHeadline: 'See whether buyers can find the judgment they would hire you for.',
    snapshotSubheadline:
      'We score the public evidence on your LinkedIn and show where deep expertise is being flattened into a list of capabilities.',
    gamePlanHeadline: 'Build a prioritized month that makes your consulting judgment legible.',
    gamePlanSubheadline:
      'Give a personal AI CMO your expertise, point of view, proof, and sales reality. Get three ranked priorities, a 20-slot month, and five retained drafts for $5.',
    costlyPattern:
      'The work is highly specific, but the public language is broad enough to describe ten thousand other consultants.',
    desiredShift:
      'Make the decisions, trade-offs, and frameworks clients pay for visible before a proposal is requested.',
    exampleContext:
      'An operations consultant with strong repeat work, a referral-heavy pipeline, and a broad LinkedIn profile.',
    exampleObjective:
      'Package the consultant’s operating judgment into a visible point of view that creates demand beyond referrals.',
    exampleFinding:
      'The profile proves experience but does not show the decision framework that makes the consultant’s approach distinct.',
    exampleEvidence: [
      'The headline uses “strategy and transformation” without naming the costly decision clients bring to the consultant.',
      'Recent posts state conclusions but rarely show the trade-offs or diagnostic questions behind them.',
      'The consultant says repeat work and referrals drive the pipeline; there is no deliberate outbound rhythm.',
      'The profile links to a general contact page with no diagnostic, memo, or reason to start a narrower conversation.',
      'Three anonymized engagements show repeatable judgment, but the public page describes them only as capabilities.',
    ],
    examplePriorities: [
      'Name the costly decision the consultant helps clients make better.',
      'Publish the trade-offs and diagnostic questions used in real engagements.',
      'Connect each proof post to one clear next conversation instead of a generic booking link.',
    ],
    exampleSlots: [
      'The hidden cost of solving an operating problem too early',
      'A decision tree built from a permitted engagement example',
      'Three signals the process is not the real bottleneck',
      'What changed after we stopped measuring activity',
      'Who should ask for an operating review this quarter',
      'The reasonable option I advise clients not to choose',
      'What an executive team should decide before buying software',
      'A client question that exposed the actual constraint',
      'Why consensus can make a transformation less safe',
      'The operating metric that changed the meeting',
      'A framework for choosing speed versus reversibility',
      'When a playbook becomes a way to avoid judgment',
      'The difference between a symptom map and a work plan',
      'What I need to believe before recommending a restructure',
      'A decision I changed after seeing new evidence',
      'The first week of a useful advisory engagement',
      'Who should not hire an outside operator yet',
      'The objection that usually signals the real project',
      'How I make an invisible decision legible to a board',
      'An invitation to map one high-cost decision',
    ],
    exampleQuestions: [
      'Which client decision best demonstrates your framework without revealing confidential details?',
      'What usually changes between the first diagnosis and the final recommendation?',
      'Which engagement is a poor fit even when the client can afford it?',
    ],
    examplePostTitle: 'Good advice is not the product',
    examplePostBody:
      'Clients rarely pay a consultant because they need another list of best practices.\n\nThey pay because two reasonable choices are in front of them and the cost of choosing badly is high.\n\nYour content should make that judgment visible. Name the decision. Show the trade-off. Explain what changes the answer.\n\nA reader may not copy your recommendation. That is fine. If they understand why the decision is harder than it looked, they now understand what your expertise is for.',
  },
  coaches: {
    slug: 'coaches',
    singular: 'coach',
    plural: 'coaches',
    switchLabel: 'Coaches',
    snapshotHeadline: 'See whether your LinkedIn makes the change you create believable.',
    snapshotSubheadline:
      'We score what a buyer can actually see and show where strong coaching work is being hidden behind inspiration, broad promises, or an unnamed method.',
    gamePlanHeadline: 'Build a month around the client change you can actually evidence.',
    gamePlanSubheadline:
      'Give a personal AI CMO your method, permitted client evidence, audience language, and enrollment reality. Get three ranked priorities, 20 slots, and five retained drafts for $5.',
    costlyPattern:
      'The feed is encouraging, but a serious buyer still cannot see the method, proof, or first step behind the transformation.',
    desiredShift:
      'Show the lived moments, coaching decisions, and client evidence that make the offer feel specific and safe to buy.',
    exampleContext:
      'A leadership coach with strong client conversations, irregular content, and a method that has never been named publicly.',
    exampleObjective:
      'Make the coaching method and client change visible without turning the feed into motivational advice or constant pitching.',
    exampleFinding:
      'The content names the aspiration repeatedly but rarely shows the coaching decision that moves a client toward it.',
    exampleEvidence: [
      'The headline promises leadership confidence but does not name the situation, buyer, or method behind the change.',
      'Eight of the last ten posts are encouraging observations with no coaching moment, question, or behavioral evidence.',
      'The coach says enrollment depends on referrals and launch periods rather than a repeatable conversation path.',
      'The profile offers a discovery call but no smaller way to recognize the problem or understand the method first.',
      'Client notes contain specific before-and-after moments, but the public proof remains broad and anonymous.',
    ],
    examplePriorities: [
      'Give the method a plain-language spine buyers can repeat.',
      'Turn anonymized coaching moments into evidence of how change happens.',
      'Create one low-pressure weekly invitation tied to the problem discussed that week.',
    ],
    exampleSlots: [
      'The moment confidence advice stops helping',
      'A coaching question that changed the real problem',
      'What progress looked like before the visible win',
      'Why accountability was not the missing piece',
      'An invitation for leaders carrying this quietly',
      'The behavior I watch before a client names the issue',
      'What “I need more time” can actually protect',
      'A client win that looked like a smaller reaction',
      'Why the right question can feel less supportive',
      'The boundary that made the next conversation possible',
      'My three-part map for a decision under pressure',
      'When self-awareness turns into another delay',
      'What changed when a leader stopped rehearsing certainty',
      'The difference between discomfort and misalignment',
      'A coaching assumption I no longer make',
      'What the first two weeks of this work really require',
      'Who will not enjoy my coaching style',
      'The question to ask before booking another program',
      'How we know a client can carry the change alone',
      'An invitation to name the decision underneath the feeling',
    ],
    exampleQuestions: [
      'Which client moment can be anonymized without flattening what actually changed?',
      'What do you ask or notice that a motivational post would miss?',
      'Who gets worse results from your method, and why?',
    ],
    examplePostTitle: 'The client did not need more confidence',
    examplePostBody:
      'When a leader says, “I need to feel more confident before I decide,” confidence may not be the real problem.\n\nOne useful coaching move is to separate the decision from the reaction the leader is trying to avoid. Naming that reaction can make the options clearer.\n\nBroad confidence advice often stalls because it treats the feeling as the problem. Good coaching looks for the decision underneath it.\n\nBefore publishing a client version of this post, add a permitted source moment or label it as a general coaching observation.',
  },
  'solo-experts': {
    slug: 'solo-experts',
    singular: 'solo expert',
    plural: 'solo experts',
    switchLabel: 'Solo experts',
    snapshotHeadline: 'See what your LinkedIn is teaching people to remember you for.',
    snapshotSubheadline:
      'We score the visible evidence around your profile and content, then show where range and curiosity are diluting the one problem you want to own.',
    gamePlanHeadline: 'Choose the commercial idea to reinforce, then build the month around it.',
    gamePlanSubheadline:
      'Give a personal AI CMO your body of work, commercial goal, buyer, and proof. Get three ranked priorities, a 20-slot month, and five retained drafts for $5.',
    costlyPattern:
      'The work is good and the interests are real, but the market has to solve a new puzzle every time it sees your name.',
    desiredShift: 'Keep the range while making one commercial idea unmistakably yours.',
    exampleContext:
      'An established independent expert with several revenue streams, strong ideas, and no single visible through-line.',
    exampleObjective:
      'Build recognition around one commercial problem without flattening the expert’s range or voice.',
    exampleFinding:
      'The content demonstrates intelligence across many topics but gives the buyer no stable problem to associate with the expert.',
    exampleEvidence: [
      'The headline combines three disciplines and four audiences without a stable commercial question tying them together.',
      'Recent posts are individually strong, but their topics do not accumulate around one buyer problem.',
      'The expert says opportunities arrive through a mixed network and are difficult to predict or qualify.',
      'Several products and links compete for attention, so an interested reader has to choose a path without context.',
      'Past projects show a recurring decision pattern, but that connection has never been made explicit in public.',
    ],
    examplePriorities: [
      'Choose one commercial idea to repeat from multiple lived angles for 30 days.',
      'Use the wider interests as evidence and texture, not competing positioning statements.',
      'Create a clear next step for readers who recognize themselves in the problem.',
    ],
    exampleSlots: [
      'The problem I keep finding underneath three different projects',
      'A story from the work that changed my operating rule',
      'The framework I use when two good options compete',
      'What most advice misses about becoming known for something',
      'A simple next step for experts with the same pattern',
      'The surprising connection between two parts of my work',
      'A client question I now use as a positioning test',
      'Why range is useful after the commercial question is clear',
      'The project I would decline even though I could do it',
      'What one year of scattered demand taught me',
      'A three-lens framework for choosing the next offer',
      'The signal that curiosity has become avoidance',
      'How a personal interest became commercially useful evidence',
      'What consistency means when your work keeps evolving',
      'The belief about niching I changed my mind about',
      'The smallest way to make a body of work legible',
      'Who should preserve range instead of narrowing further',
      'The question every new project should reinforce',
      'How I decide whether an idea belongs in public',
      'An invitation to find the question connecting your work',
    ],
    exampleQuestions: [
      'Which past projects share the same high-value decision even if the deliverables look different?',
      'Which revenue path matters most over the next 90 days?',
      'What part of your range must remain visible because it creates trust or useful contrast?',
    ],
    examplePostTitle: 'Being multi-passionate is not the positioning problem',
    examplePostBody:
      'You do not need to erase your range to become known for something.\n\nYou need a stable commercial question that your range keeps helping you answer.\n\nThe musician, the operator, and the strategist can all stay. But when they appear in public, they should illuminate the same problem from different angles.\n\nConsistency is not repeating one opinion forever. It is giving people enough connected evidence to know what to come to you for.',
  },
};

export function getBlueprintAudience(slug: string): BlueprintAudienceCopy | undefined {
  return blueprintAudiences[slug as BlueprintAudienceSlug];
}
