Do a security and privacy review of the current changes (git diff against main, or the files in $ARGUMENTS).

Check against docs/SECURITY_PRIVACY.md specifically:
- Every supporter/user/stats query goes through server/utils/scope.ts.
- Responses use the serialisers; no raw rows; masking is correct for each role.
- No forbidden fields (PVC/VIN/NIN/BVN/religion/ethnicity); no PII in logs.
- Consent enforced server-side; audit entries for sensitive actions.
- Access-control matrix test has entries for any new route.
- Rate limits and input validation on new endpoints.

Report findings as: severity · file:line · issue · fix. Then fix the high/critical ones after I confirm.
