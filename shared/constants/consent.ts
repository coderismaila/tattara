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

/** Used when NUXT_PUBLIC_ORG_NAME is not set. */
export const DEFAULT_ORG_NAME: Record<ConsentLanguage, string> = {
  ha: 'Jam\'iyya',
  en: 'The party',
}

/**
 * The script the lead reads aloud before ticking "They agree" (draft for legal review, SECURITY_PRIVACY §2).
 * Changing a script's meaning needs a NEW version; records keep the version they were read in.
 */
const CONSENT_SCRIPTS: Record<ConsentVersion, (org: string) => string> = {
  // TODO(ha-review): machine-drafted Hausa; a native speaker and legal review must approve it before the pilot (7.4).
  'c1-ha': org => `${org} tana tattara jerin magoya bayanta domin ta tuntuɓe ka game da ayyukan jam'iyya da zaɓe. `
    + 'Za mu rubuta sunanka, lambar wayarka, adireshinka da rumfar zaɓenka. Masu kula da yankinka na jam\'iyya ne kaɗai '
    + 'za su iya ganin bayananka. Za mu aiko maka da SMS; za ka iya amsawa da STOP a kowane lokaci domin a cire ka. '
    + 'Ka amince?',
  'c1-en': org => `${org} is keeping a list of its supporters to contact you about party activities and elections. `
    + 'We will record your name, phone number, address and polling unit. Only party coordinators for your area can see '
    + 'your details. We will send you an SMS; you can reply STOP at any time to be removed. Do you agree?',
}

/** The current version for each language. */
export const CURRENT_CONSENT_VERSION: Record<ConsentLanguage, ConsentVersion> = { ha: 'c1-ha', en: 'c1-en' }

export function consentScript(version: ConsentVersion, orgName?: string | null): string {
  const org = orgName?.trim() || DEFAULT_ORG_NAME[consentLanguageOf(version)]
  return CONSENT_SCRIPTS[version](org)
}
