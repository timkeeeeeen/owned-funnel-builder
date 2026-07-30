import { collection, config, fields } from '@keystatic/core';

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

export default config({
  storage: { kind: 'local' },
  ui: {
    brand: { name: 'Owned Funnel Builder' },
    navigation: { Offers: ['offers'] },
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
        slug: fields.slug({
          name: {
            label: 'Page address',
            description: 'The short name at the end of the page URL.',
            validation: { isRequired: true },
          },
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
              label: 'Payment provider',
              options: [{ label: 'Dodo Payments inline checkout', value: 'dodo-inline' }],
              defaultValue: 'dodo-inline',
            }),
            enabled: fields.checkbox({ label: 'Enable checkout', defaultValue: true }),
            eyebrow: requiredText('Small checkout label'),
            title: requiredText('Email step headline'),
            description: longText('Email step explanation'),
            emailLabel: requiredText('Email field label'),
            emailPlaceholder: requiredText('Email field example'),
            buttonLabel: requiredText('Checkout button text'),
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
        demoUrl: requiredText('Demo or preview link'),
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
        without: stringList('Without this product', 'Problem'),
        with: stringList('With this product', 'Benefit'),
        outcomes: copyItem('Primary outcomes'),
        video: fields.object(
          {
            ...sectionHeading(),
            embedUrl: requiredText('Video embed URL', 'Leave blank until the video is ready.'),
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
  },
});
