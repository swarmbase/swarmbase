export type PasswordItemPermission = {
  id?: string; // For React list displying.
  userId?: string;
  permission?: 'r' | 'rw';
};

export type PasswordItem = {
  id?: string;
  name?: string;
  value?: string;

  // Permissions.
  permissions?: PasswordItemPermission[];
};
