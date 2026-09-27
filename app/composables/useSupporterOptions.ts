// Translated choices for the supporter chip groups (capture and edit share them).
import { AGE_BANDS, GENDERS, HAS_PVC, SUPPORT_LEVELS } from '~~/shared/constants/enums'

export function useSupporterOptions() {
  const { t } = useI18n()
  const options = <T extends string>(values: readonly T[], prefix: string) =>
    computed(() => values.map(value => ({ value, label: t(`${prefix}.${value}`) })))
  return {
    genderItems: options(GENDERS, 'supporter.gender'),
    ageItems: options(AGE_BANDS, 'supporter.ageBand'),
    supportItems: options(SUPPORT_LEVELS, 'supporter.supportLevel'),
    pvcItems: options(HAS_PVC, 'supporter.hasPvc'),
  }
}
