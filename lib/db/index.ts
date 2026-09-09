import { drizzle } from 'drizzle-orm/vercel-postgres';
import {
  contentItems,
  media,
  comments,
  articleComments,
  users,
  accounts,
  sessions,
  verificationTokens,
  shares,
  shareVisits,
  mirrorVersions,
  refreshPreviews,
  visitEvents,
  analyticsSessions,
  analyticsChunks,
  appSettings,
  translationCache,
} from './schema';

export const db = drizzle(); // auto-reads POSTGRES_URL env var

export {
  contentItems,
  media,
  comments,
  articleComments,
  users,
  accounts,
  sessions,
  verificationTokens,
  shares,
  shareVisits,
  mirrorVersions,
  refreshPreviews,
  visitEvents,
  analyticsSessions,
  analyticsChunks,
  appSettings,
  translationCache,
};
