/**
 * The registry of every API operation (02 §11, 06): a new operation is a reviewed change to this
 * file, checked against the OpenAPI document by `src/openapi/document.spec.ts`. P02's
 * `CROSS_PRACTICE` follows with the first practice-scoped operation.
 */

/**
 * The operationIds that need a sign-in, with the answers each caller gets; every one answers an
 * anonymous caller 401 (`test/e2e/authz-matrix.e2e-spec.ts`). Roles join when memberships do (B01
 * for patients, A04 for staff: `test/integration/staff-mfa.int-spec.ts` holds the staff answers).
 */
export const AUTHZ_MATRIX: Readonly<Record<string, { readonly account: number }>> = {
  getMe: { account: 200 },
  updateMe: { account: 200 },
  deleteUnconfirmedAccount: { account: 204 },
  // Only the team sets up the app for now: an account without a STAFF index row.
  startTotp: { account: 403 },
  // Without a start there is no secret to confirm: MFA_CODE_INVALID.
  confirmTotp: { account: 400 },
  // A sign-in with the password only: MFA_REQUIRED before anything else.
  getMyMembership: { account: 403 },
  getProfile: { account: 200 },
  updateProfile: { account: 200 },
  listMyPractices: { account: 200 },
  joinPractice: { account: 404 },
  listMyPatients: { account: 404 },
  getMyPatient: { account: 404 },
  updateMyPatient: { account: 404 },
  bookAppointment: { account: 404 },
  getMyAppointment: { account: 404 },
  cancelAppointment: { account: 404 },
  rescheduleAppointment: { account: 404 },
  listMyAppointmentsInPractice: { account: 404 },
  listMyAppointments: { account: 200 },
};

/** The operationIds that answer without sign-in. */
export const PUBLIC_OPERATIONS: readonly string[] = [
  'register',
  'verifyEmail',
  'resendVerification',
  'login',
  'refresh',
  'logout',
  'forgotPassword',
  'resetPassword',
  'listPublicPractices',
  'getPublicPractice',
  'getPublicAvailability',
  'getPublicFreeTimes',
];
