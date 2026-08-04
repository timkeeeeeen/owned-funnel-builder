import { collection, config, fields, singleton } from '@keystatic/core';

const requiredText = (label: string, description?: string) =>
  fields.text({ label, description, validation: { isRequired: true } });

const longText = (label: string, description?: string) =>
  fields.text({ label, description, multiline: true, validation: { isRequired: true } });

const stringList = (label: string, itemLabel = 'Item') =>
  fields.array(requiredText(itemLabel), {
    label,
    itemLabel: (props) => props.value,
  });

const copyItem = (label = 'Items') =>
  fields.array(
    fields.object({
      title: requiredText('Title'),
      description: longText('Description'),
    }),
    {
      label,
      itemLabel: (props) => props.fields.title.value,
    }
  );

const sectionHeading = () => ({
  eyebrow: requiredText('Small label'),
  title: requiredText('Headline'),
  description: longText('Supporting copy'),
});

const deliveryProduct = () => ({
  productKey: requiredText('Internal product key'),
  name: requiredText('Product name'),
  priceAmount: fields.integer({
    label: 'Price in whole currency units',
    validation: { isRequired: true, min: 0 },
  }),
  currency: requiredText('Currency code'),
  deliverySubject: requiredText('Access email subject'),
  deliveryBody: longText('Access email message'),
  accessUrl: requiredText('Customer access link'),
});

export default config({
  storage: { kind: 'local' },
  ui: {
    brand: { name: 'Owned Funnel Builder' },
    navigation: {
      'Landing pages': ['offers'],
      'Checkout funnels': ['funnels'],
      'Site settings': ['site'],
    },
  },
  collections: {
    offers: collection({
      label: 'Landing pages',
      slugField: 'slug',
      path: 'src/content/offers/*',
      format: { data: 'json' },
      columns: ['productName', 'published'],
      schema: {
        published: fields.checkbox({
          label: 'Published',
          description: 'Turn this on when the page is ready to appear on the website.',
          defaultValue: false,
        }),
        template: fields.select({
          label: 'Page template',
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Video lead', value: 'video-lead' },
          ],
          defaultValue: 'default',
        }),
        slug: fields.slug({
          name: {
            label: 'Page address',
            description: 'The short name at the end of the page URL.',
            validation: { isRequired: true },
          },
        }),
        checkoutFunnelSlug: fields.text({
          label: 'Checkout funnel to reuse',
          description: 'Leave blank to use this page address.',
        }),
        productName: requiredText('Product name'),
        eyebrow: requiredText('Small line above the headline'),
        headline: requiredText('Main headline'),
        headlineAccent: requiredText('Highlighted headline words'),
        subheadline: longText('Main supporting copy'),
        metaTitle: requiredText('Search and browser title'),
        metaDescription: longText('Search description'),
        ogImage: requiredText(
          'Social sharing image path',
          'Ask your agent to add an image and put its /path here.'
        ),
        audience: longText('One-sentence audience description'),
        checkoutUrl: requiredText('Backup checkout link'),
        checkout: fields.object(
          {
            provider: fields.select({
              label: 'Checkout flow',
              options: [{ label: 'Managed Dodo or Stripe checkout', value: 'provider-checkout' }],
              defaultValue: 'provider-checkout',
            }),
            enabled: fields.checkbox({ label: 'Enable checkout', defaultValue: true }),
            eyebrow: requiredText('Small checkout label'),
            title: requiredText('Email step headline'),
            description: longText('Email step explanation'),
            emailLabel: requiredText('Email field label'),
            emailPlaceholder: requiredText('Email field example'),
            buttonLabel: requiredText('Checkout button text'),
            summaryDescription: longText('Order summary description'),
            guaranteeLabel: requiredText('Guarantee reassurance'),
            paymentTrustLabel: requiredText('Payment security reassurance'),
            consentCopy: longText('Consent message'),
            consentVersion: requiredText('Consent version'),
            bump: fields.object(
              {
                title: requiredText('Order bump name'),
                description: longText('Order bump description'),
                price: requiredText('Order bump price'),
                items: stringList('Order bump benefits', 'Benefit'),
              },
              { label: 'Order bump' }
            ),
          },
          { label: 'Checkout and order bump' }
        ),
        heroPreview: fields.object(
          {
            ariaLabel: requiredText('Accessible description'),
            windowLabel: requiredText('Small window label'),
            promptLabel: requiredText('Prompt label'),
            prompt: requiredText('Example request'),
            description: longText('Example explanation'),
            steps: fields.array(
              fields.object({
                label: requiredText('Step label'),
                title: requiredText('Step title'),
              }),
              {
                label: 'Steps',
                itemLabel: (props) => props.fields.title.value,
              }
            ),
          },
          { label: 'Hero product preview' }
        ),
        sections: fields.object(
          {
            highlights: stringList('Highlight bar', 'Highlight'),
            problemEyebrow: requiredText('Problem section small label'),
            outcomesEyebrow: requiredText('Outcomes section small label'),
            outcomesTitle: requiredText('Outcomes section headline'),
            includedEyebrow: requiredText('Included section small label'),
            includedTitle: requiredText('Included section headline'),
            bonusesEyebrow: requiredText('Bonuses section small label'),
            bonusesTitle: requiredText('Bonuses section headline'),
            proofEyebrow: requiredText('Proof section small label'),
            proofTitle: requiredText('Proof section headline'),
            proofDescription: longText('Proof section explanation'),
            proofLinkLabel: requiredText('Demo link text'),
            guaranteeBadge: requiredText('Guarantee badge'),
            guaranteeEyebrow: requiredText('Guarantee small label'),
            pricingEyebrow: requiredText('Pricing section small label'),
            pricingTitle: requiredText('Pricing section headline'),
            pricingDescription: longText('Pricing section explanation'),
            priceLabel: requiredText('Price card small label'),
            priceNote: requiredText('Price card reassurance'),
            priceIncludes: stringList('Price card inclusions', 'Inclusion'),
            faqEyebrow: requiredText('FAQ small label'),
            faqTitle: requiredText('FAQ headline'),
          },
          { label: 'Section headings and labels' }
        ),
        demoUrl: fields.text({
          label: 'Demo or preview link',
          description: 'Optional. Leave blank when there is no separate working preview.',
        }),
        currentPrice: requiredText('Current price'),
        regularPrice: requiredText('Regular price'),
        priceAmount: fields.number({
          label: 'Current price as a number',
          validation: { isRequired: true, min: 0 },
        }),
        currency: requiredText('Currency code'),
        ctaLabel: requiredText('Main button text'),
        ctaNote: requiredText('Small reassurance below buttons'),
        painTitle: requiredText('Problem section headline'),
        painBody: longText('Problem section copy'),
        withoutLabel: requiredText('Problem list label'),
        withoutTitle: requiredText('Problem list headline'),
        withLabel: requiredText('Solution list label'),
        withTitle: requiredText('Solution list headline'),
        without: stringList('Without this product', 'Problem'),
        with: stringList('With this product', 'Benefit'),
        outcomes: copyItem('Primary outcomes'),
        video: fields.object(
          {
            ...sectionHeading(),
            embedUrl: fields.text({
              label: 'Video embed URL',
              description: 'Leave blank until the video is ready.',
            }),
            fallbackTitle: requiredText('Message shown before a video is added'),
            fallbackBody: longText('Supporting message before a video is added'),
          },
          { label: 'Video' }
        ),
        productPreview: fields.object(
          {
            ...sectionHeading(),
            workspaceLabel: requiredText('Preview workspace label'),
            productLabel: requiredText('Preview product label'),
            productDescription: requiredText('Preview product description'),
            navItems: stringList('Preview navigation', 'Navigation item'),
            activeNavItem: requiredText('Selected navigation item'),
            activeEyebrow: requiredText('Preview small label'),
            activeTitle: requiredText('Preview headline'),
            activeDescription: longText('Preview description'),
            statusLabel: requiredText('Preview status'),
            stages: stringList('Preview stages', 'Stage'),
            panels: copyItem('Preview cards'),
          },
          { label: 'What it looks like' }
        ),
        assistant: fields.object(
          {
            ...sectionHeading(),
            skills: copyItem('Included agent skills'),
            conversation: fields.array(
              fields.object({
                speaker: requiredText('Speaker'),
                text: longText('Message'),
              }),
              {
                label: 'Example conversation',
                itemLabel: (props) => props.fields.speaker.value,
              }
            ),
          },
          { label: 'How you talk to the product' }
        ),
        included: copyItem("What's included"),
        gates: fields.object(
          {
            ...sectionHeading(),
            items: fields.array(
              fields.object({
                label: requiredText('Step label'),
                question: requiredText('Plain-English question'),
                description: longText('What the check does'),
                catches: longText('What it catches'),
              }),
              {
                label: 'Checks',
                itemLabel: (props) => props.fields.question.value,
              }
            ),
          },
          { label: 'Why the system works' }
        ),
        fit: fields.object(
          {
            ...sectionHeading(),
            forYou: stringList('This is for you if', 'Qualification'),
            notForYou: stringList('This is not for you if', 'Disqualification'),
          },
          { label: 'Who this is for' }
        ),
        examples: fields.object(
          {
            ...sectionHeading(),
            items: fields.array(
              fields.object({
                label: requiredText('Proof label'),
                title: requiredText('Example name'),
                description: longText('Example description'),
              }),
              {
                label: 'Example apps or outcomes',
                itemLabel: (props) => props.fields.title.value,
              }
            ),
          },
          { label: 'Examples' }
        ),
        bonuses: copyItem('Bonuses'),
        proof: fields.array(
          fields.object({
            value: requiredText('Large value'),
            label: requiredText('Short label'),
            detail: longText('Explanation'),
          }),
          {
            label: 'Proof points',
            itemLabel: (props) => `${props.fields.value.value} ${props.fields.label.value}`,
          }
        ),
        guaranteeTitle: requiredText('Guarantee headline'),
        guaranteeBody: longText('Guarantee explanation'),
        faqs: fields.array(
          fields.object({
            question: requiredText('Question'),
            answer: longText('Answer'),
          }),
          {
            label: 'Frequently asked questions',
            itemLabel: (props) => props.fields.question.value,
          }
        ),
        finalTitle: requiredText('Final call-to-action headline'),
        finalBody: longText('Final call-to-action copy'),
      },
    }),
    funnels: collection({
      label: 'Checkout funnels',
      slugField: 'offerSlug',
      path: 'src/content/funnels/*',
      format: { data: 'json' },
      columns: ['offerSlug', 'supportEmail'],
      schema: {
        offerSlug: fields.slug({
          name: {
            label: 'Landing page address',
            description: 'This must match the landing page address exactly.',
            validation: { isRequired: true },
          },
        }),
        supportEmail: requiredText('Customer support email'),
        base: fields.object(deliveryProduct(), { label: 'Main product' }),
        bump: fields.object(
          {
            key: requiredText('Order bump key'),
            ...deliveryProduct(),
          },
          { label: 'Order bump' }
        ),
        upsells: fields.array(
          fields.object({
            key: requiredText('Upsell page key'),
            ...deliveryProduct(),
            stepLabel: requiredText('Progress label'),
            eyebrow: requiredText('Small label'),
            title: requiredText('Headline'),
            accent: requiredText('Highlighted headline words'),
            description: longText('Supporting copy'),
            price: requiredText('Displayed price'),
            regularPrice: requiredText('Displayed regular price'),
            items: stringList('Included benefits', 'Benefit'),
            acceptLabel: requiredText('Yes button text'),
            declineLabel: requiredText('No thanks link text'),
          }),
          {
            label: 'One-click upsells',
            description: 'Use no more than two. The agent will verify this before publishing.',
            itemLabel: (props) => props.fields.name.value,
          }
        ),
        completion: fields.object(
          {
            title: requiredText('Thank-you headline'),
            description: longText('Thank-you explanation'),
            backLabel: requiredText('Back button text'),
          },
          { label: 'Order complete page' }
        ),
      },
    }),
  },
  singletons: {
    site: singleton({
      label: 'Site name and contact details',
      path: 'src/content/site',
      format: { data: 'json' },
      schema: {
        siteName: requiredText('Site name'),
        shortName: requiredText('Short name'),
        author: requiredText('Business or author name'),
        supportEmail: requiredText('Default support email'),
        homeEyebrow: requiredText('Home page small label'),
        homeHeadline: requiredText('Home page headline'),
        homeAccent: requiredText('Highlighted headline words'),
        homeDescription: longText('Home page supporting copy'),
        defaultImage: requiredText('Default social sharing image path'),
      },
    }),
  },
});
