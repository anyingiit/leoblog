export const PROFILES = Object.freeze(['minimal', 'legacy']);
export function resolveProfile(env = process.env) {
  const value = env.LEOBLOG_PROFILE;
  if (value === undefined || value === '') throw new Error('LEOBLOG_PROFILE is required: set it to "minimal" or "legacy"');
  if (!PROFILES.includes(value)) throw new Error('unknown static profile: LEOBLOG_PROFILE must be "minimal" or "legacy"');
  return value;
}
