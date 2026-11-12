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
  // The practice's desk (M05): a sign-in with the password only is MFA_REQUIRED before anything else.
  getDeskDay: { account: 403 },
  getDeskAppointment: { account: 403 },
  checkInAppointment: { account: 403 },
  completeAppointment: { account: 403 },
  markAppointmentNoShow: { account: 403 },
  cancelAppointmentAsPractice: { account: 403 },
  getDeskCatalog: { account: 403 },
  searchDeskAppointments: { account: 403 },
  searchDeskPatients: { account: 403 },
  getDeskAvailability: { account: 403 },
  getDeskFreeTimes: { account: 403 },
  bookDeskAppointment: { account: 403 },
  addDeskPatient: { account: 403 },
  getDeskWeek: { account: 403 },
  getDeskPatient: { account: 403 },
  changeDeskPatient: { account: 403 },
  exportDeskPatient: { account: 403 },
  // What the team sets up (M02): MFA_REQUIRED before anything else too.
  listServices: { account: 403 },
  createService: { account: 403 },
  updateService: { account: 403 },
  getOpeningHours: { account: 403 },
  replaceOpeningHours: { account: 403 },
  listSpecialDays: { account: 403 },
  createSpecialDay: { account: 403 },
  deleteSpecialDay: { account: 403 },
  // The doctors' schedules (M04): MFA_REQUIRED before anything else too.
  getWorkingHours: { account: 403 },
  replaceWorkingHours: { account: 403 },
  listAbsences: { account: 403 },
  createAbsence: { account: 403 },
  deleteAbsence: { account: 403 },
  generateSlots: { account: 403 },
  updateSlot: { account: 403 },
  setServiceProviders: { account: 403 },
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
