import type { OrganizationRole } from '../types/domain';

export const roleRank: Record<OrganizationRole, number> = {
  viewer: 10,
  editor: 20,
  admin: 30,
  owner: 40,
};

export function canAtLeast(role: OrganizationRole | undefined | null, minimum: OrganizationRole) {
  return roleRank[role || 'viewer'] >= roleRank[minimum];
}
