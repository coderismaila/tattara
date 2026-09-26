// Consent versions (SECURITY_PRIVACY §2). Each supporter record stores the version it was read in; a new wording is
// a new version, and old records keep theirs. The script text itself arrives with the capture page (3.3).
import type { ConsentLanguage } from './enums'

export const CONSENT_VERSIONS = ['c1-ha', 'c1-en'] as const
export type ConsentVersion = typeof CONSENT_VERSIONS[number]

/** The language a version's script is in: `c1-ha` → `ha`. */
export function consentLanguageOf(version: ConsentVersion): ConsentLanguage {
  return version.endsWith('-en') ? 'en' : 'ha'
}

export function isConsentVersion(value: unknown): value is ConsentVersion {
  return typeof value === 'string' && (CONSENT_VERSIONS as readonly string[]).includes(value)
}
