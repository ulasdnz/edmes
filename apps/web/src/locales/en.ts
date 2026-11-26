import { commonEn } from '@mes/frontend/i18n'

export const en = {
  ...commonEn,
  nav: {
    main: 'Main navigation',
    home: 'EDMES start page',
    collapse: 'Collapse menu',
    expand: 'Expand menu',
    system: 'System',
    users: 'Users',
  },
  topbar: {
    plantTime: 'Plant time',
    userMenu: 'User menu',
    logOut: 'Log out',
  },
  auth: {
    title: 'Sign in',
    email: 'Email',
    password: 'Password',
    showPassword: 'Show',
    hidePassword: 'Hide',
    submit: 'Sign in',
    emailRequired: 'Enter your email.',
    passwordRequired: 'Enter your password.',
    unreachable: 'The server could not be reached. Check the connection and try again.',
    timeout: 'The server took too long to answer. Try again.',
    failed: 'Sign-in failed. Try again.',
    forgotPassword: 'Forgot your password? Passwords are reset by an administrator of this plant.',
    tagline:
      'Plan and follow production, keep stops explained and read OEE for the work centers assigned to you.',
    onPremise: 'Runs on this factory network · no internet connection needed',
  },
  access: {
    noAppTitle: 'No access to the web app',
    noApp:
      'Your account has no access to the web app. An administrator can add it to one of your roles.',
    noPageTitle: 'You don’t have access to {{page}}',
    noPage:
      'This page needs the {{permission}} permission. An administrator can add it to one of your roles.',
  },
  // The names of the permissions a page asks for, as @mes/privileges names them
  privileges: {
    readUsers: 'Read Users',
  },
  home: {
    emptyTitle: 'Nothing to show yet',
    emptyMessage: 'Your roles do not open any page of the web app yet.',
  },
  errors: {
    network: 'The server could not be reached.',
    timeout: 'The server took too long to answer.',
    unexpected: 'Something went wrong.',
  },
  table: {
    showing: 'Showing {{from}}–{{to}} of {{total}}',
    rowsPerPage: 'Rows per page',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    page: 'Page {{page}}',
    pagination: 'Pages',
  },
  users: {
    title: 'Users',
    table: 'Users',
    count_one: '{{count}} user',
    count_other: '{{count}} users',
    search: 'Search users',
    searchPlaceholder: 'Search name, username or email',
    name: 'Name',
    username: 'Username',
    email: 'Email',
    workCenters: 'Work centers',
    active: 'Active',
    isActive: 'Active',
    isInactive: 'Inactive',
    empty: 'No users found',
    emptyMessage: 'No user matches this search. Change or clear it.',
    loading: 'Loading users…',
    loadFailed: 'Users could not be loaded',
  },
  notFound: {
    title: 'Page not found',
    message: 'This address does not match any page of the web app.',
  },
  version: {
    available: 'A new version of EDMES is available.',
    reload: 'Reload',
  },
}
