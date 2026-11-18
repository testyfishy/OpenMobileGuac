/**
 * Hand-built JSON fixtures following the shapes documented in docs/protocol-notes.md, which
 * come from the Guacamole 1.6.0 source. They were NOT captured from a server. All names and
 * hosts are placeholders.
 */

export const BASE_URL = 'https://guac.example/guacamole';

/** `APIAuthenticationResult` (`rest/auth/APIAuthenticationResult.java`). */
export const authResultJson = {
  authToken: 'C0FFEE0000000000000000000000000000000000000000000000000000000000',
  username: 'testuser',
  dataSource: 'postgresql',
  availableDataSources: ['postgresql', 'postgresql-shared'],
};

/** `APIError` for wrong credentials: the generic exception from `GuacamoleAuthenticationProcessException`. */
export const invalidCredentialsJson = {
  message: 'Permission Denied.',
  translatableMessage: {
    key: 'APP.TEXT_UNTRANSLATED',
    variables: { MESSAGE: 'Permission Denied.' },
  },
  statusCode: null,
  expected: [
    { name: 'username', type: 'USERNAME' },
    { name: 'password', type: 'PASSWORD' },
  ],
  patches: null,
  type: 'INVALID_CREDENTIALS',
};

/** `APIError` from the TOTP extension asking for a code (`UserVerificationService.java`). */
export const totpRequiredJson = {
  message: 'A TOTP authentication code is required before login can continue',
  translatableMessage: { key: 'TOTP.INFO_CODE_REQUIRED', variables: null },
  statusCode: null,
  expected: [{ name: 'guac-totp', type: 'GUAC_TOTP_CODE' }],
  patches: null,
  type: 'INSUFFICIENT_CREDENTIALS',
};

/** TOTP enrolment: the field exposes key details. The values are dummies. */
export const totpEnrollJson = {
  message: 'TOTP enrollment must be completed before authentication can continue',
  translatableMessage: { key: 'TOTP.INFO_ENROLL_REQUIRED', variables: null },
  expected: [
    {
      name: 'guac-totp',
      type: 'GUAC_TOTP_CODE',
      username: 'testuser',
      secret: 'AAAAAAAAAAAAAAAA',
      issuer: 'Example',
      digits: 6,
      mode: 'sha1',
      period: 30,
      qrCode: 'data:image/png;base64,AAAA',
    },
  ],
  type: 'INSUFFICIENT_CREDENTIALS',
};

/** A wrong TOTP code (`TranslatableGuacamoleClientException`, so BAD_REQUEST / 400). */
export const totpWrongCodeJson = {
  message: 'Provided TOTP code is not valid.',
  translatableMessage: { key: 'TOTP.INFO_VERIFICATION_FAILED', variables: null },
  type: 'BAD_REQUEST',
};

/** An expired or unknown token (`GuacamoleUnauthorizedException`, untranslated). */
export const permissionDeniedJson = {
  message: 'Permission Denied.',
  translatableMessage: {
    key: 'APP.TEXT_UNTRANSLATED',
    variables: { MESSAGE: 'Permission Denied.' },
  },
  type: 'PERMISSION_DENIED',
};

export const notFoundJson = {
  message: 'No such resource.',
  translatableMessage: {
    key: 'APP.TEXT_UNTRANSLATED',
    variables: { MESSAGE: 'No such resource.' },
  },
  type: 'NOT_FOUND',
};

/** `APIConnectionGroup` tree (`rest/connectiongroup/APIConnectionGroup.java`, NON_NULL). */
export const treeJson = {
  name: 'ROOT',
  identifier: 'ROOT',
  type: 'ORGANIZATIONAL',
  activeConnections: 0,
  childConnectionGroups: [
    {
      name: 'Lab',
      identifier: '3',
      parentIdentifier: 'ROOT',
      type: 'ORGANIZATIONAL',
      activeConnections: 0,
      childConnections: [
        {
          name: 'Lab VNC',
          identifier: '7',
          parentIdentifier: '3',
          protocol: 'vnc',
          attributes: { 'guacd-encryption': null, 'max-connections': '' },
          activeConnections: 1,
          lastActive: 1763452800000,
        },
      ],
      attributes: {},
    },
    {
      name: 'Pool',
      identifier: '4',
      parentIdentifier: 'ROOT',
      type: 'BALANCING',
      activeConnections: 2,
      attributes: { 'enable-session-affinity': 'true' },
    },
  ],
  childConnections: [
    {
      name: 'Desktop RDP',
      identifier: '1',
      parentIdentifier: 'ROOT',
      protocol: 'rdp',
      attributes: {},
      activeConnections: 0,
      sharingProfiles: [
        { name: 'View only', identifier: '9', primaryConnectionIdentifier: '1', attributes: {} },
      ],
    },
    {
      name: 'Shell',
      identifier: '2',
      parentIdentifier: 'ROOT',
      protocol: 'ssh',
      attributes: {},
      activeConnections: 0,
    },
  ],
  attributes: {},
};

/** A second data source with a single connection. */
export const sharedTreeJson = {
  name: 'ROOT',
  identifier: 'ROOT',
  type: 'ORGANIZATIONAL',
  activeConnections: 0,
  childConnections: [
    {
      name: 'Shared desktop',
      identifier: 'abc-123',
      parentIdentifier: 'ROOT',
      protocol: 'rdp',
      activeConnections: 0,
    },
  ],
};

/** `GET api/languages` (`rest/language/LanguageRESTService.java`). */
export const languagesJson = { en: 'English', de: 'Deutsch' };
