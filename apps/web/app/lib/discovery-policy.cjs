// Server-side opt-in. A production build alone must never publish staging.
const PUBLIC_ORIGIN = 'https://drapixai.com';

function publicIndexingEnabled(env = process.env) {
  return env.NODE_ENV === 'production'
    && env.DRAPIXAI_PUBLIC_INDEXING === '1'
    && env.NEXT_PUBLIC_WEB_BASE_URL === PUBLIC_ORIGIN;
}

module.exports = { PUBLIC_ORIGIN, publicIndexingEnabled };
