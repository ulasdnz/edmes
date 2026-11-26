import { commonEn } from '@mes/frontend/i18n'

export const en = {
  ...commonEn,
  auth: {
    title: 'Operator panel',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    unreachable: 'The server could not be reached. Check the connection and try again.',
    timeout: 'The server took too long to answer. Try again.',
    failed: 'Sign-in failed. Try again.',
  },
  access: {
    noPanelTitle: 'No access to the operator panel',
    noPanel:
      'Your account has no access to the operator panel. An administrator can add it to one of your roles.',
  },
  picker: {
    title: 'Choose the work center of this station',
    none: 'No work center is assigned to you',
    noneMessage: 'An administrator can assign a work center to you.',
    loadFailed: 'Work centers could not be loaded',
  },
  station: {
    jobOrder: 'Job order',
    running: 'Running',
    target: 'Target',
    noRunningJobOrder: 'No running job order',
    jobOrderFailed: 'The job order could not be loaded',
    workCenterFailed: 'The work center could not be loaded',
  },
  notFound: {
    title: 'Page not found',
    back: 'Back to the station',
  },
}
