import site from '@/content/site.json';

export interface SiteSettings {
  siteName: string;
  shortName: string;
  author: string;
  supportEmail: string;
  homeEyebrow: string;
  homeHeadline: string;
  homeAccent: string;
  homeDescription: string;
  defaultImage: string;
}

export const siteSettings = site satisfies SiteSettings;
