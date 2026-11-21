/**
 * Form fields of upstream sign-in steps that the app treats specially.
 *
 * The database extension's forced password change (`guacamole-auth-jdbc-base`
 * `UserService.resetExpiredPassword`, 1.6.0): an expired account is answered with
 * `INSUFFICIENT_CREDENTIALS`, key `LOGIN.INFO_PASSWORD_EXPIRED`, and these two `PASSWORD`
 * fields; they are sent together with the old username and password.
 */
export const NEW_PASSWORD_FIELD = 'new-password';
export const CONFIRM_NEW_PASSWORD_FIELD = 'confirm-new-password';
