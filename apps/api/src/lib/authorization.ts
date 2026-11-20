export const USER_ROLES = ['brand_admin', 'brand_member', 'quality_reviewer', 'system_admin'] as const;
export type UserRole = typeof USER_ROLES[number];

export type Permission =
  | 'tenant:read'
  | 'tenant:manage'
  | 'quality:review'
  | 'system:admin';

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  brand_admin: new Set(['tenant:read', 'tenant:manage']),
  brand_member: new Set(['tenant:read']),
  quality_reviewer: new Set(['quality:review']),
  system_admin: new Set(['tenant:read', 'tenant:manage', 'quality:review', 'system:admin']),
};

export const isUserRole = (role: unknown): role is UserRole =>
  typeof role === 'string' && USER_ROLES.includes(role as UserRole);

export const hasPermission = (role: unknown, permission: Permission) =>
  isUserRole(role) && ROLE_PERMISSIONS[role].has(permission);

export const isConfiguredSystemAdmin = (user: { id: number; role: unknown; email: string }) => {
  const email = (process.env.DRAPIXAI_ADMIN_EMAIL || '').trim().toLowerCase();
  const id = Number(process.env.DRAPIXAI_ADMIN_USER_ID || 0);
  return hasPermission(user.role, 'system:admin')
    && ((email.length > 0 && email === user.email.trim().toLowerCase()) || (id > 0 && id === user.id));
};

export const ownsTenantResource = (authenticatedUserId: number, resourceUserId: number) =>
  Number.isInteger(authenticatedUserId)
  && Number.isInteger(resourceUserId)
  && authenticatedUserId === resourceUserId;
